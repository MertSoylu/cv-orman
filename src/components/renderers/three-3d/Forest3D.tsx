"use client";

import { Suspense, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer, N8AO, Vignette } from "@react-three/postprocessing";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PlacedTreeData, Species } from "@/lib/forest/treeData";
import Tree3D from "./Tree3D";
import Signpost from "./Signpost";
import ExhibitEnvironment from "./ExhibitEnvironment";
import CelestialSystem from "./CelestialSystem";
import TrunkInstanceGroup from "./TrunkInstanceGroup";
import { CameraBounds, CameraRig, SelectionSpotlight, type CameraBoundsInfo, type SelectionFocusPoint } from "./SelectionFocus";
import { getTreeJitter, getVariantIndex } from "./speciesRegistry";
import { growthToScale } from "./utils";
import { useQualityTier, QUALITY_PRESETS } from "@/hooks/useQualityTier";

// computeForestLayout() already centers the exhibit path on plane (0,0) --
// just divide by a scale factor to get sane Three.js world units.
const PLANE_SCALE = 20;
const GROUND_MARGIN = 6;
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
// Camera guard rails. minY keeps the eye above the ground plane (no diving
// under the terrain); the pan margin lets the target roam a little past the
// tree spread but never off into empty space.
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

/** Full 3D exhibit scene: camera, lights, ground + path, sky, garden props, and one Tree3D + Signpost per tree. */
export default function Forest3D({ trees, onSelect, selectedId = null, isDark, onReady }: Forest3DProps) {
  // Single source of truth for "which tree is hovered", shared by every
  // Tree3D (foliage) and TrunkInstanceGroup (bark, batched across trees) --
  // a ref, not state, since it's read every frame by damped hover animations
  // rather than needing a re-render on change.
  const hoveredIdRef = useRef<string | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const qualityTier = useQualityTier();
  const preset = QUALITY_PRESETS[qualityTier];

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
  const { groundSize, groundCenter, cameraDistance, pathLength, cameraPosition, controls, fogFar, treePositions, cameraBounds } = useMemo(() => {
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
      // camera eye stays above the ground plane.
      cameraBounds: {
        center: [centerX, centerZ],
        halfX: spanX / 2 + CAMERA_PAN_MARGIN,
        halfZ: spanZ / 2 + CAMERA_PAN_MARGIN,
        minY: CAMERA_MIN_Y,
      } as CameraBoundsInfo,
    };
  }, [positions]);

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
        {/* Sky dome, scene fog, the three scene lights, and an arcing sun/moon
            -- all owned by CelestialSystem, which eases every value between a
            warm-dusk (dark) and clear-midday (light) preset each frame so the
            theme toggle animates (sun sets, moon rises, key light warms) rather
            than snapping. The sky's sun sits toward -Z in both presets: the
            default camera looks down the path toward -Z, so the glow forms the
            backdrop behind the forest instead of hiding behind the viewer. */}
        <CelestialSystem
          isDark={isDark}
          groundCenter={groundCenter}
          cameraDistance={cameraDistance}
          fogFar={fogFar}
          shadowMapSize={preset.shadowMapSize}
        />

        {/* Oversized backdrop terrain, well below the real ground plane -- gives
            the distant tree-line/hill silhouettes something to root into
            instead of floating over bare sky where the exhibit clearing ends. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[groundCenter[0], -0.15, groundCenter[1]]}>
          <planeGeometry args={[groundSize[0] + 90, groundSize[1] + 90]} />
          <meshStandardMaterial color="#5e6b38" roughness={1} />
        </mesh>

        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[groundCenter[0], 0, groundCenter[1]]} receiveShadow>
          <planeGeometry args={groundSize} />
          <meshStandardMaterial color="#66743c" roughness={1} />
        </mesh>

        {/* Gravel walkway down the exhibit's spine (plane x=0), narrower than
            the smallest tree's lateral offset so trees always stand clear of it. */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, groundCenter[1]]} receiveShadow>
          <planeGeometry args={[PATH_WIDTH, pathLength]} />
          <meshStandardMaterial color="#cbb08a" roughness={0.95} />
        </mesh>

        <ExhibitEnvironment
          groundSize={groundSize}
          groundCenter={groundCenter}
          pathLength={pathLength}
          pathWidth={PATH_WIDTH}
          treePositions={treePositions}
          showFireflies={isDark}
          qualityTier={qualityTier}
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
                <Tree3D tree={tree} onClick={onSelect} hoveredIdRef={hoveredIdRef} />
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

        {/* Stage-light + halo on the selected tree, and an interruptible
            camera fly-in toward it -- both fade/ease, nothing snaps. */}
        <SelectionSpotlight focus={selectionFocus} />
        <CameraRig focus={selectionFocus} controlsRef={controlsRef} />
        <CameraBounds bounds={cameraBounds} controlsRef={controlsRef} />

        <OrbitControls
          ref={controlsRef}
          target={controls.target}
          minDistance={controls.minDistance}
          maxDistance={controls.maxDistance}
          maxPolarAngle={Math.PI / 2 - 0.02}
        />

        {/* Post pipeline: N8AO grounds the trunks with contact occlusion,
            bloom lifts the emissive bits (sun/moon discs, fireflies, the
            selection halo -- all toneMapped=false so they clear the
            threshold), vignette pulls focus toward the path. halfRes AO +
            capped multisampling keep the whole pass cheap enough for the
            default dpr=[1,2] canvas. */}
        <EffectComposer multisampling={preset.multisampling}>
          {preset.n8ao ? <N8AO aoRadius={2} intensity={2.5} distanceFalloff={1} halfRes /> : <></>}
          {preset.bloom ? (
            <Bloom mipmapBlur luminanceThreshold={0.92} luminanceSmoothing={0.25} intensity={0.38} levels={6} />
          ) : (
            <></>
          )}
          {preset.vignette ? <Vignette offset={0.28} darkness={0.55} /> : <></>}
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
