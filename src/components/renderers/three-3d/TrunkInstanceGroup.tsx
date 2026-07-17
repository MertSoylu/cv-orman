"use client";

import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { PlacedTreeData, Species } from "@/lib/forest/treeData";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { getSpeciesBuild, getTreeJitter, getTreeSway } from "./speciesRegistry";
import { growthToScale, introProgress } from "./utils";

const HOVER_SCALE_EXTRA = 0.06;
// Same lambda Tree3D's foliage hover uses -- keeps trunk and foliage pop in
// visual sync even though each is damped by its own independent useFrame.
const HOVER_DAMP_LAMBDA = 3.5;

interface GroupTree {
  tree: PlacedTreeData;
  index: number;
  sway: ReturnType<typeof getTreeSway>;
  /** position * yaw * finalScale -- everything about this tree's placement except sway and hover, which change per frame. */
  baseMatrix: THREE.Matrix4;
}

export interface TrunkInstanceGroupProps {
  species: Species;
  variantIndex: number;
  trees: PlacedTreeData[];
  positions: Map<string, [number, number, number]>;
  onSelect: (id: string) => void;
  /** Shared with every tree's Tree3D -- single source of truth for "which tree is hovered" so bark (here) and foliage (Tree3D) pop in sync regardless of which one the pointer is actually over. */
  hoveredIdRef: MutableRefObject<string | null>;
  /** Selected tree stays glowing -- mirrors Tree3D's selectedIdRef so bark and foliage stay in sync. */
  selectedIdRef: MutableRefObject<string | null>;
}

/**
 * Renders every tree's trunk/branch parts for one (species, variant) bucket
 * as a shared set of InstancedMesh -- one per part index -- instead of the
 * treeCount * partsPerTree individual <mesh> draw calls Tree3D used to emit
 * per bucket. part.color never varies per tree within a variant (species
 * builders bake one bark color per build), so a single shared material per
 * part is exact, not an approximation.
 *
 * Trade-off: standard MeshStandardMaterial has no per-instance emissive, so
 * the hover glow Tree3D puts on foliage doesn't extend to bark here --
 * hovering still pops the whole tree's scale (trunk here and foliage in
 * Tree3D read the same seeded jitter/sway and the same hoveredIdRef, so they
 * move together), it just doesn't add a bark-level glow on top of that.
 * Foliage stays per-tree (already a single drei <Instances> draw call each,
 * not the bottleneck this component exists to fix) and keeps its glow.
 */
export default function TrunkInstanceGroup({
  species,
  variantIndex,
  trees,
  positions,
  onSelect,
  hoveredIdRef,
  selectedIdRef,
}: TrunkInstanceGroupProps) {
  const build = useMemo(() => getSpeciesBuild(species, variantIndex), [species, variantIndex]);
  const reducedMotion = usePrefersReducedMotion();
  const meshRefs = useRef<(THREE.InstancedMesh | null)[]>([]);
  const hoverT = useRef<Float32Array>(new Float32Array(0));
  // First-frame scene-clock time -- grow-in intro staggers off elapsed time
  // since mount, mirroring Tree3D so bark and crown sprout together.
  const introStart = useRef<number | null>(null);

  const groupTrees = useMemo<GroupTree[]>(() => {
    return trees.map((tree, index) => {
      const worldPosition = positions.get(tree.id) ?? [0, 0, 0];
      const jitter = getTreeJitter(tree.id);
      const sway = getTreeSway(tree.id);
      const finalScale = growthToScale(tree.growthScore) * jitter.scaleVariance;
      const baseMatrix = new THREE.Matrix4().compose(
        new THREE.Vector3(...worldPosition),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(0, jitter.rotationY, 0)),
        new THREE.Vector3(finalScale, finalScale, finalScale)
      );
      return { tree, index, sway, baseMatrix };
    });
  }, [trees, positions]);

  // Static per-part local transform (position/rotation/scale baked into the
  // species build) -- precomputed once per part, reused for every instance.
  const partLocalMatrices = useMemo(
    () =>
      build.parts.map((part) => {
        const [px, py, pz] = part.position;
        const [rx, ry, rz] = part.rotation ?? [0, 0, 0];
        const [sx, sy, sz] = part.scale ?? [1, 1, 1];
        return new THREE.Matrix4().compose(
          new THREE.Vector3(px, py, pz),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
          new THREE.Vector3(sx, sy, sz)
        );
      }),
    [build.parts]
  );

  // Scratch objects, reused every frame instead of allocated per-instance --
  // this loop runs treeCount * partCount times per frame.
  const scratch = useRef({
    sway: new THREE.Matrix4(),
    hoverScale: new THREE.Matrix4(),
    combined: new THREE.Matrix4(),
    euler: new THREE.Euler(),
  }).current;

  useFrame(({ clock }, delta) => {
    if (hoverT.current.length !== groupTrees.length) {
      hoverT.current = new Float32Array(groupTrees.length);
    }

    const t = clock.elapsedTime;
    if (introStart.current === null) introStart.current = t;
    const introElapsed = t - introStart.current;
    const hovered = hoveredIdRef.current;
    const selected = selectedIdRef.current;

    for (const gt of groupTrees) {
      const target = (hovered === gt.tree.id || selected === gt.tree.id) ? 1 : 0;
      const current = hoverT.current[gt.index] ?? 0;
      if (target !== 0 || current > 0.0005) {
        hoverT.current[gt.index] = reducedMotion ? target : THREE.MathUtils.damp(current, target, HOVER_DAMP_LAMBDA, delta);
      }
    }

    for (let partIdx = 0; partIdx < build.parts.length; partIdx++) {
      const mesh = meshRefs.current[partIdx];
      if (!mesh) continue;
      const partLocal = partLocalMatrices[partIdx];

      for (const gt of groupTrees) {
        const ht = hoverT.current[gt.index] ?? 0;
        const intro = reducedMotion ? 1 : introProgress(introElapsed, gt.tree.growthScore);
        const needsSway = !reducedMotion;
        const needsHoverScale = ht > 0.0005 || intro < 1;

        if (!needsSway && !needsHoverScale) {
          mesh.setMatrixAt(gt.index, scratch.combined.copy(gt.baseMatrix).multiply(partLocal));
          continue;
        }

        if (needsSway) {
          scratch.euler.set(
            Math.cos(t * gt.sway.speed * 0.8 + gt.sway.phase * 1.7) * gt.sway.amplitude * 0.6,
            0,
            Math.sin(t * gt.sway.speed + gt.sway.phase) * gt.sway.amplitude
          );
          scratch.sway.makeRotationFromEuler(scratch.euler);
        } else {
          scratch.sway.identity();
        }

        if (needsHoverScale) {
          const hoverScale = (1 + ht * HOVER_SCALE_EXTRA) * intro;
          scratch.hoverScale.makeScale(hoverScale, hoverScale, hoverScale);
        } else {
          scratch.hoverScale.identity();
        }

        scratch.combined.copy(gt.baseMatrix).multiply(scratch.hoverScale).multiply(scratch.sway).multiply(partLocal);
        mesh.setMatrixAt(gt.index, scratch.combined);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.instanceId == null) return;
    const gt = groupTrees[e.instanceId];
    if (!gt) return;
    hoveredIdRef.current = gt.tree.id;
    document.body.style.cursor = "pointer";
  };

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hoveredIdRef.current = null;
    document.body.style.cursor = "auto";
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId == null) return;
    const gt = groupTrees[e.instanceId];
    if (gt) onSelect(gt.tree.id);
  };

  return (
    <>
      {build.parts.map((part, partIdx) => (
        <instancedMesh
          key={partIdx}
          ref={(m) => {
            meshRefs.current[partIdx] = m;
          }}
          args={[part.geometry, undefined, groupTrees.length]}
          castShadow
          receiveShadow
          // Instance matrices are set imperatively via setMatrixAt, never
          // through computeBoundingSphere() -- the mesh's default bounding
          // volume ignores per-instance transforms entirely, so leaving
          // frustum culling on risks the whole group popping out of view
          // once trees scatter across a wide exhibit path (same reasoning as
          // ExhibitEnvironment's backdrop ring).
          frustumCulled={false}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          onClick={handleClick}
        >
          {/* vertexColors: bark crevice shading is baked into the geometry's
              color attribute by applyBarkNoise (limbs without bark carry flat
              white via ensureColorAttribute), so one shared material per part
              still shows per-vertex bark depth across every instance. */}
          <meshStandardMaterial color={part.color} roughness={0.9} metalness={0} vertexColors />
        </instancedMesh>
      ))}
    </>
  );
}
