"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer, GodRays, N8AO, Vignette } from "@react-three/postprocessing";
import { KernelSize } from "postprocessing";
import type { DepthOfFieldEffect } from "postprocessing";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PlacedTreeData, Species } from "@/lib/forest/treeData";
import Tree3D from "./Tree3D";
import Signpost from "./Signpost";
import ExhibitEnvironment from "./ExhibitEnvironment";
import CelestialSystem from "./CelestialSystem";
import TrunkInstanceGroup from "./TrunkInstanceGroup";
import Terrain from "./Terrain";
import GroundMist from "./GroundMist";
import { CameraBounds, type CameraBoundsInfo, type SelectionFocusPoint } from "./SelectionFocus";
import { getTreeJitter, getVariantIndex } from "./speciesRegistry";
import { growthToScale } from "./utils";
import { useQualityTier, QUALITY_PRESETS } from "@/hooks/useQualityTier";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

// computeForestLayout() already centers the exhibit path on plane (0,0) --
// just divide by a scale factor to get sane Three.js world units.
const PLANE_SCALE = 20;
const GROUND_MARGIN = 6;
// How far the terrain continues past the tree spread -- far enough that the
// backdrop ring (groundSize/2 + ~15-40) roots into real relief, not void.
const TERRAIN_MARGIN = 45;
const CAMERA_FOV = 55;
// How far a signpost sits in front of its own tree's trunk, toward the
// camera (camera always sits at centerZ + distance, i.e. the +Z side, so a
// positive Z offset always reads as "closer to viewer") -- clears the
// canopy's near-side foliage bulge, which otherwise sits right on top of a
// plaque placed at the trunk's own depth.
const SIGNPOST_FORWARD_OFFSET = 1.2;
// Tallest tree (oak trunk+canopy) can reach ~9 world units at max growthScore
// scale -- half the vertical frustum has to clear that above the ~2.6-unit
// look-at height, or the back rows crop off the top of the canvas.
const CANOPY_CLEARANCE = 5.5;
const PATH_WIDTH = 4.4;
// Camera guard rails. minY keeps the eye above the terrain surface (the
// relief-aware clamp lives in CameraBounds); the pan margin lets the target
// roam a little past the tree spread but never off into empty space.
const CAMERA_MIN_Y = 1.2;
const CAMERA_PAN_MARGIN = 8;

function planeToWorld(x: number, y: number): [number, number, number] {
  // Plane x -> world X, plane y -> world Z (path depth).
  return [x / PLANE_SCALE, 0, y / PLANE_SCALE];
}

export interface Forest3DProps {
  trees: PlacedTreeData[];
  onSelect: (id: string) => void;
  /** Currently selected tree id (drives the spotlight + camera fly-in), or null. */
  selectedId?: string | null;
  /** Picks the day/night lighting preset -- follows the site's dark-mode toggle, not a separate scene setting. */
  isDark: boolean;
  /** Fired once the WebGL scene has completed its first frame, so the caller can drop a loading overlay. */
  onReady?: () => void;
}

/** Full 3D exhibit scene: camera, lights, terrain, path, sky, garden props, and one Tree3D + Signpost per tree. */
export default function Forest3D({ trees, onSelect, selectedId = null, isDark, onReady }: Forest3DProps) {
  // Single source of truth for "which tree is hovered", shared by every
  // Tree3D (foliage) and TrunkInstanceGroup (bark, batched across trees) --
  // a ref, not state, since it's read every frame by damped hover animations
  // rather than needing a re-render on change.
  const hoveredIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  const qualityTier = useQualityTier();
  const preset = QUALITY_PRESETS[qualityTier];

  // Sun/moon core meshes, lifted out of CelestialSystem via ref callbacks --
  // the GodRays post effect needs a real Mesh as its light source. State (not
  // refs) so the composer re-renders once they arrive.
  const [sunMesh, setSunMesh] = useState<THREE.Mesh | null>(null);
  const [moonMesh, setMoonMesh] = useState<THREE.Mesh | null>(null);

  const positions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const tree of trees) {
      map.set(tree.id, planeToWorld(tree.x, tree.y));
    }
    return map;
  }, [trees]);

  // Trunk/branch parts don't vary by tree within a (species, variant)
  // bucket (same bark color, same geometry) -- bucket every tree so
  // TrunkInstanceGroup can batch them into a handful of InstancedMesh
  // instead of Tree3D's old treeCount * partsPerTree individual draw calls.
  const trunkGroups = useMemo(() => {
    const groups = new Map<string, { species: Species; variantIndex: number; trees: PlacedTreeData[] }>();
    for (const tree of trees) {
      const variantIndex = getVariantIndex(tree.id);
      const key = `${tree.species}:${variantIndex}`;
      let group = groups.get(key);
      if (!group) {
        group = { species: tree.species, variantIndex, trees: [] };
        groups.set(key, group);
      }
      group.trees.push(tree);
    }
    return Array.from(groups.entries());
  }, [trees]);

  // World-space anchor for the selection spotlight + camera fly-in -- scale
  // matches Tree3D's final world scale so the ground halo hugs the canopy.
  const selectionFocus = useMemo<SelectionFocusPoint | null>(() => {
    if (!selectedId) return null;
    const tree = trees.find((t) => t.id === selectedId);
    const position = tree && positions.get(tree.id);
    if (!tree || !position) return null;
    return {
      position,
      scale: growthToScale(tree.growthScore) * getTreeJitter(tree.id).scaleVariance,
    };
  }, [selectedId, trees, positions]);

  // Ground/path/camera all derive from the actual tree spread instead of a
  // fixed plane size, so the exhibit hall self-sizes to however many repos
  // there are rather than leaving a handful of trees lost in a big empty lot.
  const { groundSize, groundCenter, cameraDistance, pathLength, cameraPosition, controls, fogFar, treePositions, cameraBounds, shadowExtent } =
    useMemo(() => {
      let minX = 0;
      let maxX = 0;
      let minZ = 0;
      let maxZ = 0;
      for (const [x, , z] of positions.values()) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z);
        maxZ = Math.max(maxZ, z);
      }

      const spanX = maxX - minX;
      const spanZ = maxZ - minZ;
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;

      // Fit the whole depth of the path (half-span in front + behind center)
      // plus canopy height inside the vertical FOV, viewed from centerZ --
      // a plain "distance = spanZ * k" guess put the camera almost inside the
      // last row once paths grew past ~2 rows, cropping trees off the canvas.
      const halfVerticalFov = (CAMERA_FOV * Math.PI) / 180 / 2;
      const requiredDistance = (spanZ / 2 + CANOPY_CLEARANCE) / Math.tan(halfVerticalFov);
      const distance = Math.max(requiredDistance * 1.0, 10);

      return {
        groundSize: [spanX + GROUND_MARGIN * 2, spanZ + GROUND_MARGIN * 2] as [number, number],
        groundCenter: [centerX, centerZ] as [number, number],
        // Sun/moon placement scales off this so they stay framed at every repo
        // count (camera distance and the sky both grow together), instead of a
        // groundSize-based radius that flings them above the frustum on small sets.
        cameraDistance: distance,
        pathLength: spanZ + GROUND_MARGIN,
        // Lower, eye-level-ish vantage: reads as standing at the garden gate,
        // not hovering over a diorama.
        cameraPosition: [0, distance * 0.3, centerZ + distance] as [number, number, number],
        controls: {
          target: [0, 2.1, centerZ] as [number, number, number],
          minDistance: Math.max(distance * 0.35, 6),
          maxDistance: distance * 2.2,
        },
        // Keep the horizon hazy but never let fog swallow the back rows -- has
        // to clear the backdrop ring's own placement radius (groundSize/2 + up
        // to ~40) plus camera distance, or the far side of the ring renders as
        // a flat, fully-fogged solid instead of a hazy silhouette.
        fogFar: Math.max(110, distance * 2.8),
        treePositions: Array.from(positions.values()),
        // Pan/height guard rails: target may roam the tree spread plus a margin,
        // camera eye stays above the terrain.
        cameraBounds: {
          center: [centerX, centerZ],
          halfX: spanX / 2 + CAMERA_PAN_MARGIN,
          halfZ: spanZ / 2 + CAMERA_PAN_MARGIN,
          minY: CAMERA_MIN_Y,
        } as CameraBoundsInfo,
        // Shadow camera follows the real forest extent (was a fixed ±40 --
        // fine for the 8-tree fixture, but resolution thinned out fast on
        // wider forests at 1024-2048 map sizes).
        shadowExtent: THREE.MathUtils.clamp(Math.max(spanX, spanZ) / 2 + 12, 24, 80),
      };
    }, [positions]);

  // GodRays source: the visible celestial body. Sun by day, moon at night --
  // whichever exists already (meshes arrive one frame after mount).
  const godRaysSource = isDark ? moonMesh ?? sunMesh : sunMesh ?? moonMesh;

  return (
    <Canvas
      shadows
      camera={{ position: cameraPosition, fov: CAMERA_FOV, near: 0.1, far: 400 }}
      dpr={preset.dpr}
      onCreated={(state) => {
        // Dev-only escape hatch: lets tooling force a frame / inspect the
        // scene when the tab is hidden (RAF frozen), e.g. for screenshots.
        if (process.env.NODE_ENV === "development") {
          (window as unknown as { __forestState?: unknown }).__forestState = state;
        }
        onReady?.();
      }}
    >
      <Suspense fallback={null}>
        {/* Sky dome, scene fog, the three scene lights, the star field, and an
            arcing sun/moon -- all owned by CelestialSystem, which eases every
            value between a warm-dusk (dark) and clear-midday (light) preset
            each frame so the theme toggle animates (sun sets, moon rises,
            stars fade in, key light warms) rather than snapping. */}
        <CelestialSystem
          isDark={isDark}
          groundCenter={groundCenter}
          cameraDistance={cameraDistance}
          fogFar={fogFar}
          shadowMapSize={preset.shadowMapSize}
          shadowExtent={shadowExtent}
          onSunCore={setSunMesh}
          onMoonCore={setMoonMesh}
        />

        {/* Single continuous terrain: relief grows from a flat exhibit
            corridor out into rolling hills that carry the backdrop ring.
            Replaces the old pair of flat ground/backdrop planes. */}
        <Terrain
          size={[groundSize[0] + TERRAIN_MARGIN * 2, groundSize[1] + TERRAIN_MARGIN * 2]}
          center={groundCenter}
          segments={preset.terrainSegments}
        />

        {/* Gravel walkway down the exhibit's spine (plane x=0), narrower than
            the smallest tree's lateral offset so trees always stand clear of
            it. Sits on the flattened corridor, so y=0.01 is safe. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, groundCenter[1]]} receiveShadow>
          <planeGeometry args={[PATH_WIDTH, pathLength]} />
          <meshStandardMaterial color="#cbb08a" roughness={0.95} />
        </mesh>

        {preset.groundFog && <GroundMist size={groundSize} center={groundCenter} isDark={isDark} />}

        <ExhibitEnvironment
          groundSize={groundSize}
          groundCenter={groundCenter}
          pathLength={pathLength}
          pathWidth={PATH_WIDTH}
          treePositions={treePositions}
          showFireflies={isDark}
          qualityTier={qualityTier}
          grassDensity={preset.grassDensity}
          leafDriftCount={preset.leafDriftCount}
        />

        {trunkGroups.map(([key, group]) => (
          <TrunkInstanceGroup
            key={key}
            species={group.species}
            variantIndex={group.variantIndex}
            trees={group.trees}
            positions={positions}
            onSelect={onSelect}
            hoveredIdRef={hoveredIdRef}
            selectedIdRef={selectedIdRef}
          />
        ))}

        {trees.map((tree) => {
          const position = positions.get(tree.id);
          if (!position) return null;
          const signpostPosition: [number, number, number] = [
            position[0] * 0.55,
            0,
            position[2] + SIGNPOST_FORWARD_OFFSET,
          ];
          return (
            <group key={tree.id}>
              <group position={position}>
                <Tree3D tree={tree} onClick={onSelect} hoveredIdRef={hoveredIdRef} selectedIdRef={selectedIdRef} foliageDensity={preset.foliageDensity} />
              </group>
              <Signpost
                position={signpostPosition}
                label={tree.name}
                healthStage={tree.healthStage}
                onClick={() => onSelect(tree.id)}
              />
            </group>
          );
        })}

        {/* Ground glow ring under hovered/selected tree — subtle warm halo
            that catches the bloom pass, replacing the old stage-light. */}
        <HoverGroundGlow positions={positions} hoveredIdRef={hoveredIdRef} selectedIdRef={selectedIdRef} />

        {/* Always-on guard rails: keeps the camera inside the exhibit footprint
            and above the terrain, regardless of selection or fly-in. */}
        <CameraBounds bounds={cameraBounds} controlsRef={controlsRef} />

        <OrbitControls
          ref={controlsRef}
          target={controls.target}
          minDistance={controls.minDistance}
          maxDistance={controls.maxDistance}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />

        {/* Post pipeline: N8AO grounds the trunks with contact occlusion,
            god rays shaft light off the active celestial body, bloom lifts
            the emissive bits (sun/moon discs, fireflies, mushroom caps, the
            selection halo), DOF focuses the selected tree, vignette pulls
            focus toward the path. halfRes AO + capped multisampling keep the
            whole pass cheap enough for the tier's dpr. */}
        <EffectComposer multisampling={preset.multisampling}>
          {preset.n8ao ? <N8AO aoRadius={2} intensity={2.5} distanceFalloff={1} halfRes /> : <></>}
          {preset.godRays && godRaysSource ? (
            <GodRays
              sun={godRaysSource}
              samples={qualityTier === "ultra" ? 48 : 36}
              density={0.96}
              decay={0.92}
              weight={0.55}
              exposure={0.35}
              clampMax={0.95}
              kernelSize={KernelSize.SMALL}
              blur
            />
          ) : (
            <></>
          )}
          {preset.bloom ? (
            <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.25} intensity={0.38} levels={5} />
          ) : (
            <></>
          )}
          {preset.dof ? <SelectionDOF focus={selectionFocus} /> : <></>}
          {preset.vignette ? <Vignette offset={0.28} darkness={0.55} /> : <></>}
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}

/**
 * Subtle warm ground halo under the hovered or clicked tree. Fades in/out
 * smoothly via damp, pulses gently, and uses toneMapped=false so the bloom
 * pass picks it up — reads as a soft glow around the trunk base without the
 * overhead stage-light of the old SelectionSpotlight.
 */
function HoverGroundGlow({
  positions,
  hoveredIdRef,
  selectedIdRef,
}: {
  positions: Map<string, [number, number, number]>;
  hoveredIdRef: { current: string | null };
  selectedIdRef: { current: string | null };
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const glowT = useRef(0);

  useFrame(({ clock }, delta) => {
    const ring = ringRef.current;
    const mat = matRef.current;
    if (!ring || !mat) return;

    const activeId = hoveredIdRef.current ?? selectedIdRef.current;
    const target = activeId !== null ? 1 : 0;
    glowT.current = THREE.MathUtils.damp(glowT.current, target, 5, delta);

    if (activeId !== null) {
      const pos = positions.get(activeId);
      if (pos) {
        ring.position.set(pos[0], 0.03, pos[2]);
      }
    }

    const pulse = 1 + Math.sin(clock.elapsedTime * 2.2) * 0.04;
    ring.scale.setScalar(1.1 * pulse);
    mat.opacity = glowT.current * 0.55;
    ring.visible = glowT.current > 0.005;
  });

  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.65, 1, 48]} />
      <meshBasicMaterial
        ref={matRef}
        color="#ffd27a"
        transparent
        opacity={0}
        toneMapped={false}
        depthWrite={false}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Depth-of-field controller: sharp scene while nothing is selected (bokeh
 * damped to 0); on selection the auto-focus target eases onto the tree and
 * the bokeh ramps up, so the exhibit melts into a soft backdrop behind the
 * repo you're inspecting. Driven imperatively (per-frame damp) -- never a
 * prop snap. Ultra tier only.
 */
function SelectionDOF({ focus }: { focus: SelectionFocusPoint | null }) {
  const effectRef = useRef<DepthOfFieldEffect | null>(null);
  const target = useRef(new THREE.Vector3(0, 2.2, 0));
  const bokeh = useRef(0);
  const reducedMotion = usePrefersReducedMotion();
  // ~2.2 matches the selection spotlight's fade lambda so focus and stage
  // light bloom together.
  const DOF_DAMP_LAMBDA = 2.2;
  const BOKEH_MAX = 2.4;

  useFrame((_, delta) => {
    const effect = effectRef.current;
    if (!effect) return;
    const active = focus !== null;
    bokeh.current = reducedMotion
      ? active
        ? BOKEH_MAX
        : 0
      : THREE.MathUtils.damp(bokeh.current, active ? BOKEH_MAX : 0, DOF_DAMP_LAMBDA, delta);

    if (focus) {
      const [x, , z] = focus.position;
      const goalY = 2.2 * focus.scale;
      target.current.x = reducedMotion ? x : THREE.MathUtils.damp(target.current.x, x, DOF_DAMP_LAMBDA, delta);
      target.current.y = reducedMotion ? goalY : THREE.MathUtils.damp(target.current.y, goalY, DOF_DAMP_LAMBDA, delta);
      target.current.z = reducedMotion ? z : THREE.MathUtils.damp(target.current.z, z, DOF_DAMP_LAMBDA, delta);
    }

    effect.target = target.current;
    effect.bokehScale = bokeh.current;
  });

  return <DepthOfField ref={effectRef} focusRange={7} bokehScale={0} />;
}
