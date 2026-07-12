"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { Instance, Instances } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { PlacedTreeData } from "@/lib/forest/treeData";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { getSpeciesBuild, getTreeJitter, getTreeSway, getVariantIndex } from "./speciesRegistry";
import { DRY_PALETTE, growthToScale, healthyToWilted, introProgress, seededRandom, wiltAmount } from "./utils";

const HOVER_EMISSIVE = new THREE.Color("#ffffff");
const HOVER_SCALE_EXTRA = 0.06;
const HOVER_EMISSIVE_INTENSITY = 0.08;
// Lower = slower, more languid settle. Exponential damping (frame-rate
// independent) instead of an instant snap -- was a hard 0/1 toggle on the
// hovered boolean, which read as an abrupt pop.
const HOVER_DAMP_LAMBDA = 3.5;

// Shared across every tree's litter instances -- one flat pentagon disc,
// squashed/tilted per instance, reads as a fallen leaf from exhibit distance.
const LITTER_GEOMETRY = new THREE.CircleGeometry(1, 5);

interface FoliageInstance {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: THREE.Color;
}

export interface Tree3DProps {
  tree: PlacedTreeData;
  onClick: (id: string) => void;
  /** Shared with every other tree's Tree3D and with TrunkInstanceGroup -- single source of truth for "which tree is hovered" so bark (instanced, batched across trees in TrunkInstanceGroup) and foliage (here) pop/glow in sync regardless of which one the pointer actually landed on. */
  hoveredIdRef: MutableRefObject<string | null>;
}

/**
 * Renders one tree's instanced foliage cluster + fallen-leaf litter,
 * positioned/colored from precomputed growth+health. Trunk/branch parts are
 * NOT rendered here -- they're batched across every tree sharing this
 * tree's (species, variant) into a handful of InstancedMesh by
 * TrunkInstanceGroup (see Forest3D), since those parts don't vary by tree
 * (same bark color, same geometry) and were the actual per-tree draw-call
 * multiplier. Foliage stays per-tree: it's already a single drei <Instances>
 * draw call each (not the bottleneck), and per-tree foliage differs in
 * clump count/color (wilt-based culling and color jitter), which a shared
 * cross-tree instance would have to fight rather than benefit from.
 */
export default function Tree3D({ tree, onClick, hoveredIdRef }: Tree3DProps) {
  const swayRef = useRef<THREE.Group>(null);
  const scaleGroupRef = useRef<THREE.Group>(null);
  const hoverT = useRef(0);
  // Scene-clock time of this tree's first frame -- the grow-in intro
  // (introProgress) staggers off elapsed time since then, not absolute clock
  // time, so trees mounted after the clock started still animate from zero.
  const introStart = useRef<number | null>(null);
  const foliageMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const reducedMotion = usePrefersReducedMotion();

  // Which cached (species, variant) geometry this tree uses -- a pure
  // function of tree.id, so the same tree always lands on the same variant,
  // but the variant pool itself stays small and pre-built.
  const variantIndex = useMemo(() => getVariantIndex(tree.id), [tree.id]);

  const build = useMemo(() => getSpeciesBuild(tree.species, variantIndex), [tree.species, variantIndex]);

  const scale = useMemo(() => growthToScale(tree.growthScore), [tree.growthScore]);

  // Deterministic per-tree jitter seeded from id: subtle rotation + scale
  // variance so a forest of same-variant trees doesn't look copy-pasted,
  // while staying stable across re-renders (no Math.random per frame). Also
  // used by TrunkInstanceGroup so bark rotates/scales identically to this
  // tree's foliage.
  const jitter = useMemo(() => getTreeJitter(tree.id), [tree.id]);

  const wiltedFoliageColor = useMemo(() => healthyToWilted(build.foliageColor, tree.healthStage), [build, tree.healthStage]);

  // Wilt reshapes the canopy, not just its color: clumps thin out (seeded
  // shuffle, keep the head of the list), sag downward, and shrink slightly.
  // Per-clump color still jitters around the shared wilted base so foliage
  // reads as varied leaf mass instead of one flat tone. Self-contained
  // generator so it replays identically however often React invokes the memo.
  const foliage = useMemo<FoliageInstance[]>(() => {
    const wilt = wiltAmount(tree.healthStage);
    const rand = seededRandom(`${tree.id}:foliage`);
    const hsl = { h: 0, s: 0, l: 0 };

    const shuffled = build.foliageClumps
      .map((clump) => ({ clump, sortKey: rand() }))
      .sort((a, b) => a.sortKey - b.sortKey);
    const keepCount = Math.max(1, Math.round(shuffled.length * (1 - wilt * 0.5)));

    return shuffled.slice(0, keepCount).map(({ clump }) => {
      const droop = wilt * (0.08 + rand() * 0.22);
      const shrink = 1 - wilt * (0.12 + rand() * 0.16);
      wiltedFoliageColor.getHSL(hsl);
      const color = new THREE.Color();
      color.setHSL(
        THREE.MathUtils.clamp(hsl.h + (rand() - 0.5) * 0.04, 0, 1),
        hsl.s,
        THREE.MathUtils.clamp(hsl.l + (rand() - 0.5) * 0.12, 0, 1)
      );
      return {
        position: [clump.position[0], clump.position[1] - droop, clump.position[2]] as [number, number, number],
        rotation: clump.rotation,
        scale: [clump.scale[0] * shrink, clump.scale[1] * shrink, clump.scale[2] * shrink] as [number, number, number],
        color,
      };
    });
  }, [build.foliageClumps, wiltedFoliageColor, tree.id, tree.healthStage]);

  // Fallen-leaf ring: the clumps culled from a wilting canopy end up on the
  // ground around the trunk. Skipped entirely while the tree is healthy.
  const litter = useMemo(() => {
    const wilt = wiltAmount(tree.healthStage);
    if (wilt < 0.25) return [];
    const rand = seededRandom(`${tree.id}:litter`);
    const count = Math.round(6 + wilt * 26);
    return Array.from({ length: count }, () => {
      const angle = rand() * Math.PI * 2;
      const radius = 0.45 + rand() * (0.7 + wilt * 1.1);
      const size = 0.05 + rand() * 0.07;
      return {
        position: [Math.cos(angle) * radius, 0.015 + rand() * 0.02, Math.sin(angle) * radius] as [number, number, number],
        rotation: [-Math.PI / 2 + (rand() - 0.5) * 0.5, rand() * Math.PI * 2, 0] as [number, number, number],
        scale: [size, size, size] as [number, number, number],
        color: wiltedFoliageColor.clone().lerp(DRY_PALETTE.dark, rand()),
      };
    });
  }, [tree.id, tree.healthStage, wiltedFoliageColor]);

  // Ambient wind: the whole crown group leans a few milliradians on a seeded
  // phase/speed so neighboring trees never sway in lockstep. Same formula
  // TrunkInstanceGroup applies to this tree's bark, so crown and trunk sway
  // together instead of visibly decoupling.
  const sway = useMemo(() => getTreeSway(tree.id), [tree.id]);

  const finalScale = scale * jitter.scaleVariance;

  useFrame(({ clock }, delta) => {
    const t = clock.elapsedTime;
    if (introStart.current === null) introStart.current = t;

    if (swayRef.current && !reducedMotion) {
      swayRef.current.rotation.z = Math.sin(t * sway.speed + sway.phase) * sway.amplitude;
      swayRef.current.rotation.x = Math.cos(t * sway.speed * 0.8 + sway.phase * 1.7) * sway.amplitude * 0.6;
    }

    const target = hoveredIdRef.current === tree.id ? 1 : 0;
    hoverT.current = reducedMotion ? target : THREE.MathUtils.damp(hoverT.current, target, HOVER_DAMP_LAMBDA, delta);

    if (scaleGroupRef.current) {
      // Mount intro: staggered grow-in, same curve TrunkInstanceGroup applies
      // to this tree's bark so crown and trunk sprout as one.
      const intro = reducedMotion ? 1 : introProgress(t - introStart.current, tree.growthScore);
      const s = finalScale * (1 + hoverT.current * HOVER_SCALE_EXTRA) * intro;
      scaleGroupRef.current.scale.setScalar(s);
    }
    if (foliageMaterialRef.current) foliageMaterialRef.current.emissiveIntensity = hoverT.current * HOVER_EMISSIVE_INTENSITY;
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick(tree.id);
  };

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoveredIdRef.current = tree.id;
    document.body.style.cursor = "pointer";
  };

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoveredIdRef.current = null;
    document.body.style.cursor = "auto";
  };

  return (
    <group
      rotation={[0, jitter.rotationY, 0]}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <group ref={scaleGroupRef} scale={[finalScale, finalScale, finalScale]}>
        <group ref={swayRef}>
          {build.foliageGeometry && foliage.length > 0 && (
            <Instances limit={foliage.length} geometry={build.foliageGeometry} castShadow receiveShadow>
              <meshStandardMaterial
                ref={foliageMaterialRef}
                roughness={0.78}
                metalness={0}
                emissive={HOVER_EMISSIVE}
                emissiveIntensity={0}
              />
              {foliage.map((clump, i) => (
                <Instance key={`f${i}`} position={clump.position} rotation={clump.rotation} scale={clump.scale} color={clump.color} />
              ))}
            </Instances>
          )}
        </group>

        {/* Litter sits outside the sway group -- fallen leaves don't wave with the crown. */}
        {litter.length > 0 && (
          <Instances limit={litter.length} geometry={LITTER_GEOMETRY} receiveShadow>
            <meshStandardMaterial roughness={0.95} metalness={0} side={THREE.DoubleSide} />
            {litter.map((leaf, i) => (
              <Instance key={`l${i}`} position={leaf.position} rotation={leaf.rotation} scale={leaf.scale} color={leaf.color} />
            ))}
          </Instances>
        )}
      </group>
    </group>
  );
}
