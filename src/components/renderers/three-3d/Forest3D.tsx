"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer, GodRays, N8AO, Vignette } from "@react-three/postprocessing";
import { KernelSize } from "postprocessing";
import type { DepthOfFieldEffect } from "postprocessing";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { PlacedTreeData } from "@/lib/forest/treeData";
import {
  computePathSpan,
  nearestOnPath,
  pathNormalAt,
  pathOffsetPoint,
  pathPointAt,
  pathTangentAt,
} from "@/lib/forest/path";
import {
  useQualityTier,
  QUALITY_PRESETS,
  EFFECT_LEVELS,
  START_EFFECT_LEVEL,
} from "@/hooks/useQualityTier";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import Atmosphere from "./atmosphere/Atmosphere";
import GroundFog from "./atmosphere/GroundFog";
import Motes from "./atmosphere/Motes";
import { createSkyState } from "./atmosphere/skyState";
import Terrain from "./terrain/Terrain";
import Trail from "./terrain/Trail";
import Water from "./terrain/Water";
import { KERB_CLEARANCE } from "./terrain/Kerb";
import { trailHalfWidth } from "./terrain/crossing";
import { PLANE_SCALE, terrainHeight } from "./terrain/heightfield";
import Undergrowth from "./props/Undergrowth";
import Waterside from "./props/Waterside";
import Gateway from "./props/Gateway";
import TreeMarkers, { type TreeMarkerPlacement } from "./props/TreeMarkers";
import TreeField from "./trees/TreeField";
import { getTreeMetrics } from "./trees/registry";
import Plaques, { type PlaquePlacement } from "./Plaques";
import CameraRig, { type CameraBoundsInfo, type SelectionFocusPoint } from "./CameraRig";

/**
 * Scene root for the forest exhibit.
 *
 * The scene sizes itself entirely from the tree set: the trail is as long as it
 * needs to be for however many repos exist, and the terrain, camera framing,
 * fog and shadow volume all derive from that. There is no fixed plane size
 * anywhere.
 *
 * The default framing is deliberately *not* a fit-everything wide shot. It puts
 * the viewer at the head of the trail, a few paces short of the near gate,
 * looking down the walk through it -- close enough that the near trees render
 * their full leaf-card foliage. Pulling back to survey the whole valley is a
 * zoom away, and at that range the LOD system has already swapped the distant
 * canopies for hulls.
 */

const CAMERA_FOV = 52;
/** How far the terrain extends past the tree spread, so hills carry the horizon. */
const TERRAIN_MARGIN = 95;
/** Trail overshoot past the first and last tree row, in plane units. */
const TRAIL_OVERSHOOT = 420;
/** Radius the sun and moon arc on. Comfortably inside the camera's far plane. */
const CELESTIAL_RADIUS = 240;
const CAMERA_PAN_MARGIN = 14;
const CAMERA_MIN_CLEARANCE = 1.4;

/** Eye height at rest. A little above head height, so the two files of plots read as files. */
const EYE_HEIGHT = 3.8;
/** Where the near gate stands, as a fraction of the trail's overshoot past the first station. */
const GATE_FRACTION = 0.62;
/**
 * Plane units the resting eye stands back from the gate, square to it.
 *
 * Far enough that both piers sit comfortably inside the frame with the walk
 * between them. Closer in, the near pier looms into a frame edge and the gate
 * stops being an arch you look through and becomes an object you are standing
 * inside.
 */
const EYE_BACKOFF = 245;
/** Forward window of trail the resting look-at averages over, measured from the gate. */
const AIM_NEAR = 80;
const AIM_FAR = 620;
/**
 * Height above the ground the resting look-at sits at. Above the eye, so the
 * view pitches very slightly up: aimed level or down, a quarter of the frame is
 * empty ground between the camera and the gate.
 */
const AIM_HEIGHT = 4.2;

/** Setback of a plaque post from the kerb's outer face, in world units. */
const PLAQUE_SETBACK = 0.34;
/** Where a specimen's stepping stones meet the walk, measured past the kerb. */
const SPUR_ANCHOR_SETBACK = 0.2;
/** Clear ground left between a specimen's plot and the kerb, so the walk stays walkable. */
const PLOT_KERB_GAP = 0.5;

/**
 * How many frames the scene takes to build, and what lands on each.
 *
 * Everything in this exhibit is generated at runtime -- a fifty-thousand-vertex
 * terrain grid sampled against the heightfield, eight species' worth of branch
 * systems, several thousand rejection-sampled ground-cover placements, and the
 * entire texture set drawn from noise. Mounted in one pass that is a single
 * uninterruptible task, and it measured the best part of a second: the tab stops
 * answering the pointer, the loading indicator stops turning, and the scene
 * arrives all at once after a hang. The work is the work -- but *when* it runs
 * is a choice, and running it in one block is the choice that reads as broken.
 *
 * Split across frames the total is the same, and the browser gets to paint and
 * drain its input queue between the pieces. The stages follow the order the
 * exhibit itself is set out in -- the ground and the light, then the walk
 * through it, then the specimens standing beside the walk, then the cover
 * rejection-sampled against all of it -- which is also, not by coincidence, the
 * order of what depends on what. The split points are chosen so the two most
 * expensive pieces never land on the same frame: the terrain grid and its
 * ground textures on one, the eight species' branch systems and their bark on
 * another. Nobody sees the half-built frames -- the page's loading overlay
 * stays up until the last stage has rendered (`onReady` fires from
 * `SceneBuild`, not from the `Canvas`'s `onCreated`).
 */
const STAGE_GROUND = 0;
const STAGE_WALK = 1;
const STAGE_SPECIMENS = 2;
const STAGE_COVER = 3;
const SCENE_STAGES = 4;

export interface Forest3DProps {
  trees: PlacedTreeData[];
  onSelect: (id: string) => void;
  /** Currently selected tree id (drives the selection glow + camera fly-in), or null. */
  selectedId?: string | null;
  /** Picks the day/night lighting preset -- follows the site's dark-mode toggle, not a separate scene setting. */
  isDark: boolean;
  /** Fired once the WebGL scene has completed its first frame, so the caller can drop a loading overlay. */
  onReady?: () => void;
}

export default function Forest3D({ trees, onSelect, selectedId = null, isDark, onReady }: Forest3DProps) {
  // Single source of truth for "which tree is hovered", shared by the tree
  // field, the plaques and the ground halo. A ref, not state: it is read every
  // frame by damped animations rather than needing a re-render on change.
  const hoveredIdRef = useRef<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  // How much of the scene has been mounted so far -- see `SCENE_STAGES`.
  const [stage, setStage] = useState(STAGE_GROUND);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const qualityTier = useQualityTier();
  const preset = QUALITY_PRESETS[qualityTier];
  const reducedMotion = usePrefersReducedMotion();

  // Which rung of the post-processing ladder we are on. Null until the governor
  // has had an opinion, so the static tier picks the opening rung and the
  // measured frame rate picks every one after that.
  const [effectLevel, setEffectLevel] = useState<number | null>(null);
  const level = effectLevel ?? START_EFFECT_LEVEL[qualityTier];
  const effects = EFFECT_LEVELS[level];
  const dpr = useMemo<[number, number]>(
    () => [preset.dpr[0] * effects.dprScale, preset.dpr[1] * effects.dprScale],
    [preset.dpr, effects.dprScale],
  );

  // GodRays needs a real Mesh as its light source, so the sun and moon are
  // lifted out of Atmosphere by ref callback. State, not refs, so the composer
  // re-renders once they arrive a frame after mount.
  const [sunMesh, setSunMesh] = useState<THREE.Mesh | null>(null);
  const [moonMesh, setMoonMesh] = useState<THREE.Mesh | null>(null);

  // Live sky colors, mutated in place by Atmosphere and read by Water the same
  // frame. Created once so both sides keep the same object identity.
  const skyState = useMemo(() => createSkyState(isDark), []); // eslint-disable-line react-hooks/exhaustive-deps

  /** World position of every tree's base, dropped onto the terrain. */
  const positions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    for (const tree of trees) {
      const x = tree.x / PLANE_SCALE;
      const z = tree.y / PLANE_SCALE;
      // Seat the trunk a hair into the ground: sitting exactly on the surface
      // leaves a visible sliver of daylight under the root flare on any slope.
      map.set(tree.id, [x, terrainHeight(x, z) - 0.06, z]);
    }
    return map;
  }, [trees]);

  /**
   * The trail's own frame at each specimen's station.
   *
   * Everything the exhibit stands on the ground beside a tree -- the plot, its
   * edging, its stepping stones, its lantern, its plaque -- has to be set out
   * from the *walk*, not from the tree. Deriving that frame once here is what
   * keeps them square to each other and to the kerb; when the plaque solved for
   * its own position and the plot for its own, the two drifted apart by a few
   * degrees per station and the whole run read as slightly crooked.
   */
  const stations = useMemo(
    () =>
      trees.map((tree) => {
        const near = nearestOnPath(tree.x, tree.y);
        const halfWidth = trailHalfWidth(near.s);
        return {
          tree,
          s: near.s,
          side: near.side,
          halfWidth,
          /** World distance from the centerline out to this specimen. */
          reach: near.distance / PLANE_SCALE,
          normal: pathNormalAt(near.s),
          tangent: pathTangentAt(near.s),
        };
      }),
    [trees],
  );

  const scene = useMemo(() => {
    const span = computePathSpan(trees.length);
    const sStart = span.start - TRAIL_OVERSHOOT;
    const sEnd = span.end + TRAIL_OVERSHOOT;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, , z] of positions.values()) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    if (!Number.isFinite(minX)) {
      minX = maxX = minZ = maxZ = 0;
    }

    const spanX = maxX - minX;
    const spanZ = maxZ - minZ;
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const reach = Math.max(spanX, spanZ);

    // --- where the visit begins: square in front of the near gate ------------
    // Aim first, then place the eye. The look-at is a distance-weighted average
    // of the trail beyond the gate rather than one point on it -- a single
    // distant station swings the walk hard to one side of frame as soon as the
    // trail bends, while the weighted mean follows the walk without being
    // yanked by its far end. The eye is then backed off from the gate along that
    // same line, which puts eye, gate and look-at colinear: the gate lands dead
    // centre by construction, at whatever angle the trail happens to leave at.
    //
    // Backing off along the *trail's tangent* instead is the obvious version and
    // it does not work -- the aim and the tangent differ by however much the
    // curve turns over the aim window, and the gate ends up that far off centre.
    const gateS = sStart + TRAIL_OVERSHOOT * GATE_FRACTION;
    const gate = trailPoint(gateS);
    const look = trailAim(gateS + AIM_NEAR, gateS + AIM_FAR);
    const back = new THREE.Vector2(gate.x - look.x, gate.z - look.z).normalize();
    const entry = groundPoint(
      gate.x + (back.x * EYE_BACKOFF) / PLANE_SCALE,
      gate.z + (back.y * EYE_BACKOFF) / PLANE_SCALE,
    );

    return {
      sStart,
      sEnd,
      gateMarks: [gateS, sEnd - TRAIL_OVERSHOOT * GATE_FRACTION],
      bounds: { minX: minX - 55, maxX: maxX + 55, minZ: minZ - 55, maxZ: maxZ + 55 },
      terrainSize: [spanX + TERRAIN_MARGIN * 2, spanZ + TERRAIN_MARGIN * 2] as [number, number],
      terrainCenter: [centerX, centerZ] as [number, number],
      // Fog starts well past the near trees -- pulled in close it hazes the
      // exhibit itself -- and has to reach past the far hills, or the horizon
      // renders as one flat band of fog colour instead of a silhouette.
      fogNear: 55,
      fogFar: Math.max(230, reach * 2.4 + TERRAIN_MARGIN),
      restPosition: [entry.x, entry.y + EYE_HEIGHT, entry.z] as [number, number, number],
      restTarget: [look.x, look.y + AIM_HEIGHT, look.z] as [number, number, number],
      maxDistance: Math.max(reach * 1.15, 70),
      waterExtent: Math.max(spanX / 2, 30) + TERRAIN_MARGIN,
      cameraBounds: {
        center: [centerX, centerZ],
        halfX: spanX / 2 + CAMERA_PAN_MARGIN,
        halfZ: spanZ / 2 + CAMERA_PAN_MARGIN,
        minClearance: CAMERA_MIN_CLEARANCE,
      } as CameraBoundsInfo,
      // Shadow volume follows the real forest extent rather than a fixed box:
      // at 1024-2048 map sizes a generous fixed volume thins out fast. The
      // margin has to cover the *trail head* as well as the tree spread, though
      // -- the resting camera stands a good way outside the exhibit's own
      // bounds, and a volume sized to the trees alone leaves the whole opening
      // frame unshadowed, which with a low sun is exactly where the shadows were
      // supposed to be doing the most work.
      shadowExtent: THREE.MathUtils.clamp(reach / 2 + 30, 44, 95),
    };
  }, [positions, trees.length]);

  /**
   * Plaques stand just clear of the kerb, on the same side as their tree.
   *
   * Set out from the kerb rather than from the gravel's centerline width, so
   * every placard along the walk keeps the same visible gap to the stone edge
   * even where the ribbon breathes wider.
   */
  const plaquePlacements = useMemo<PlaquePlacement[]>(
    () =>
      stations.map(({ tree, s, side, halfWidth, normal }) => {
        const lateral = side * (halfWidth + KERB_CLEARANCE + PLAQUE_SETBACK) * PLANE_SCALE;
        const point = pathOffsetPoint(s, lateral);
        const x = point.x / PLANE_SCALE;
        const z = point.y / PLANE_SCALE;
        return {
          id: tree.id,
          label: tree.name,
          healthStage: tree.healthStage,
          position: [x, terrainHeight(x, z), z],
          // Face back across the trail, toward someone walking it.
          yaw: Math.atan2(-normal.x * side, -normal.y * side),
        };
      }),
    [stations],
  );

  /**
   * The plot, edging, stepping stones and lantern that mark a tree as part of
   * the exhibit.
   *
   * The plot is squared to the walk, so its extents are expressed across and
   * along the trail rather than as one radius. The across extent is the one
   * with a hard constraint: the plot must not reach the kerb, or the walk
   * pinches shut at every station. Since it is capped rather than the specimen
   * being moved, a large tree simply gets a plot that is longer than it is wide
   * -- which is what a bed beside a path looks like anyway.
   */
  const markerPlacements = useMemo<TreeMarkerPlacement[]>(
    () =>
      // Held back with the rest of the exhibit stage: `getTreeMetrics` is what
      // first builds a species' branch system, so measuring a plot is what pays
      // for the geometry, and leaving this ungated puts that cost back on the
      // first frame however carefully the meshes themselves are staged.
      stage < STAGE_SPECIMENS
        ? []
        : stations.map(({ tree, s, side, halfWidth, reach, tangent }) => {
            const world = positions.get(tree.id) ?? ([0, 0, 0] as [number, number, number]);
            const metrics = getTreeMetrics(tree, preset.foliageDensity);
            const radius = THREE.MathUtils.clamp(metrics.spread * 0.62, 1.15, 2.6);

            const toKerb = reach - (halfWidth + KERB_CLEARANCE);
            const anchor = pathOffsetPoint(
              s,
              side * (halfWidth + KERB_CLEARANCE + SPUR_ANCHOR_SETBACK) * PLANE_SCALE,
            );

            return {
              id: tree.id,
              position: world,
              yaw: Math.atan2(tangent.x, tangent.y),
              halfAcross: THREE.MathUtils.clamp(radius, 0.8, Math.max(0.8, toKerb - PLOT_KERB_GAP)),
              halfAlong: radius * 1.4,
              towardTrail: side,
              spurAnchor: [anchor.x / PLANE_SCALE, anchor.y / PLANE_SCALE],
            };
          }),
    [stage, stations, positions, preset.foliageDensity],
  );

  const selectionFocus = useMemo<SelectionFocusPoint | null>(() => {
    if (!selectedId) return null;
    const tree = trees.find((candidate) => candidate.id === selectedId);
    const position = tree && positions.get(tree.id);
    if (!tree || !position) return null;
    return { position, scale: getTreeMetrics(tree, preset.foliageDensity).scale };
  }, [selectedId, trees, positions, preset.foliageDensity]);

  const godRaysSource = isDark ? moonMesh ?? sunMesh : sunMesh ?? moonMesh;

  return (
    <Canvas
      shadows
      camera={{ position: scene.restPosition, fov: CAMERA_FOV, near: 0.35, far: 900 }}
      dpr={dpr}
      gl={{ antialias: false, powerPreference: "high-performance" }}
      onCreated={(state) => {
        state.gl.toneMapping = THREE.ACESFilmicToneMapping;
        state.gl.toneMappingExposure = 1.05;
        // Dev-only escape hatch: lets tooling inspect the scene, measure the
        // draw-call budget, and drive the camera for verification screenshots.
        // The controls arrive a frame later, so the *ref* is exposed rather
        // than its value.
        if (process.env.NODE_ENV === "development") {
          const debug = window as unknown as {
            __forestState?: unknown;
            __forestControls?: unknown;
          };
          debug.__forestState = state;
          debug.__forestControls = controlsRef;
        }
      }}
    >
      <Suspense fallback={null}>
        {/* --- stage 0: the ground and the light ---------------------------- */}
        <Atmosphere
          isDark={isDark}
          center={scene.terrainCenter}
          radius={CELESTIAL_RADIUS}
          fogNear={scene.fogNear}
          fogFar={scene.fogFar}
          shadowMapSize={preset.shadowMapSize}
          shadowExtent={scene.shadowExtent}
          skyState={skyState}
          onSunCore={setSunMesh}
          onMoonCore={setMoonMesh}
        />

        <Terrain
          size={scene.terrainSize}
          center={scene.terrainCenter}
          segments={preset.terrainSegments}
        />
        {/* --- stage 1: the walk through it --------------------------------- */}
        {stage >= STAGE_WALK && (
          <>
            <Trail sStart={scene.sStart} sEnd={scene.sEnd} />

            <Water
              extent={scene.waterExtent}
              skyHorizon={skyState.horizon}
              skyZenith={skyState.zenith}
              sunDirection={skyState.sunDirection}
              sunColor={skyState.sunColor}
            />

            <Gateway marks={scene.gateMarks} isDark={isDark} />

            <Plaques placements={plaquePlacements} onSelect={onSelect} hoveredIdRef={hoveredIdRef} />
          </>
        )}

        {/* --- stage 2: the specimens standing beside it -------------------- */}
        {stage >= STAGE_SPECIMENS && (
          <>
            <TreeField
              trees={trees}
              positions={positions}
              onSelect={onSelect}
              hoveredIdRef={hoveredIdRef}
              selectedIdRef={selectedIdRef}
              foliageDensity={preset.foliageDensity}
              detailedLeaves={preset.detailedLeaves && effects.detailedLeaves}
              reducedMotion={reducedMotion}
              decorCount={preset.decorTrees}
              decorBounds={scene.bounds}
            />

            <TreeMarkers placements={markerPlacements} isDark={isDark} />

            <HoverHalo positions={positions} hoveredIdRef={hoveredIdRef} selectedIdRef={selectedIdRef} />
          </>
        )}

        {/* --- stage 3: the cover, rejection-sampled against all of the above */}
        {stage >= STAGE_COVER && (
          <>
            {preset.groundFog && (
              <GroundFog
                size={scene.terrainSize}
                center={scene.terrainCenter}
                isDark={isDark}
                reducedMotion={reducedMotion}
              />
            )}

            <Undergrowth
              bounds={scene.bounds}
              sStart={scene.sStart}
              sEnd={scene.sEnd}
              grassCount={preset.grassCount}
              detailCount={preset.detailCount}
              plots={markerPlacements}
              isDark={isDark}
              reducedMotion={reducedMotion}
            />

            <Waterside
              extent={scene.waterExtent}
              reedCount={preset.reedCount}
              waterDetail={preset.waterDetail}
              isDark={isDark}
              reducedMotion={reducedMotion}
            />

            <Motes
              count={preset.moteCount}
              bounds={scene.bounds}
              isDark={isDark}
              reducedMotion={reducedMotion}
              pixelRatio={preset.dpr[1]}
            />
          </>
        )}

        <SceneBuild stage={stage} onAdvance={setStage} onComplete={onReady} />

        <CameraRig
          controlsRef={controlsRef}
          restPosition={scene.restPosition}
          restTarget={scene.restTarget}
          focus={selectionFocus}
          bounds={scene.cameraBounds}
        />

        <OrbitControls
          ref={controlsRef}
          makeDefault
          minDistance={5}
          maxDistance={scene.maxDistance}
          enablePan
          maxPolarAngle={Math.PI / 2 - 0.03}
          // `dampingFactor` is deliberately not set here. It is a per-*frame*
          // fraction, so a literal makes the camera's response time a function
          // of the frame rate; `CameraRig` re-derives it from the frame delta
          // instead, which is the only way the glide is the same length in
          // seconds on every machine.
          enableDamping
        />

        {/* N8AO grounds trunks and props with contact occlusion, god rays shaft
            light off whichever celestial body is up, bloom lifts the emissive
            bits (sun, moon, lanterns, fireflies, hover glow), DOF melts the
            background behind a selected tree, and the vignette pulls the eye
            back to the trail. Antialiasing is handled by the composer's
            multisampling, which is why the WebGL context requests none. */}
        <PerfGovernor level={level} maxLevel={EFFECT_LEVELS.length - 1} onChange={setEffectLevel} />

        <EffectComposer multisampling={effects.multisampling}>
          {effects.n8ao ? (
            <N8AO
              aoRadius={2.2}
              intensity={2.2}
              distanceFalloff={1}
              halfRes
              aoSamples={8}
              denoiseSamples={4}
              depthAwareUpsampling={false}
            />
          ) : (
            <></>
          )}
          {effects.godRays && godRaysSource ? (
            <GodRays
              sun={godRaysSource}
              samples={qualityTier === "ultra" ? 48 : 36}
              density={0.95}
              decay={0.92}
              weight={0.5}
              exposure={0.32}
              clampMax={0.95}
              kernelSize={KernelSize.SMALL}
              blur
            />
          ) : (
            <></>
          )}
          {effects.bloom ? (
            <Bloom mipmapBlur luminanceThreshold={0.9} luminanceSmoothing={0.28} intensity={0.42} levels={5} />
          ) : (
            <></>
          )}
          {effects.dof ? <SelectionDOF focus={selectionFocus} /> : <></>}
          {effects.vignette ? <Vignette offset={0.3} darkness={0.5} /> : <></>}
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}

/**
 * Walks the scene up one stage per rendered frame, and reports when the last one
 * is on screen.
 *
 * Advancing from a frame callback rather than from an effect is what makes the
 * split worth anything: the stage that has just mounted is guaranteed to have
 * been *drawn* before the next one is asked for, so the browser has had a paint
 * and an input-queue drain in between. Advancing from a `useEffect` chain
 * instead would run all three builds back to back inside the same commit and
 * hand the user exactly the block this is here to break up.
 *
 * `onComplete` is deliberately fired from here rather than from the `Canvas`'s
 * `onCreated`. `onCreated` runs before a single object exists in the scene, so
 * the page's loading overlay used to come down over an empty valley and let the
 * build's frames show through; holding it until the last stage has rendered
 * means the reveal is of a finished exhibit.
 */
function SceneBuild({
  stage,
  onAdvance,
  onComplete,
}: {
  stage: number;
  onAdvance: (stage: number) => void;
  onComplete?: () => void;
}) {
  const settled = useRef(0);

  useFrame(() => {
    if (stage < SCENE_STAGES - 1) {
      onAdvance(stage + 1);
      return;
    }
    // Frame callbacks run *before* the draw, so the frame this one is called on
    // is the first that will contain the last stage rather than the first that
    // does. One more, and the overlay comes down over something already on
    // screen.
    settled.current += 1;
    if (settled.current === 2) onComplete?.();
  });

  return null;
}

/** World-space point sitting on the terrain. */
function groundPoint(x: number, z: number): THREE.Vector3 {
  return new THREE.Vector3(x, terrainHeight(x, z), z);
}

/** World-space point on the trail centerline, sitting on the terrain. */
function trailPoint(s: number): THREE.Vector3 {
  const point = pathPointAt(s);
  return groundPoint(point.x / PLANE_SCALE, point.y / PLANE_SCALE);
}

/**
 * Distance-weighted mean of the trail centerline over a forward window -- the
 * point that puts the most walk down the middle of frame.
 *
 * The centerline is two out-of-phase sines, so any single station on it is
 * offset from the run either side of it; aiming at one throws the walk left or
 * right of frame depending purely on where the camera stands in the curve's
 * phase. The mean has no such bias. Weights fall off with distance so the aim
 * still tracks the near walk -- an unweighted mean over a long window drifts
 * toward wherever the trail ends up, which is not where the visitor is looking.
 */
function trailAim(from: number, to: number, samples = 13): THREE.Vector3 {
  const mean = new THREE.Vector3();
  const scratch = new THREE.Vector3();
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const weight = 1 - t * 0.85;
    mean.add(scratch.copy(trailPoint(from + (to - from) * t)).multiplyScalar(weight));
    total += weight;
  }
  return mean.divideScalar(total);
}

/** Frame-time the governor steers to. */
const TARGET_MS = 1000 / 60;
/** Frames per measurement window. */
const GOVERNOR_WINDOW = 50;
/**
 * Seconds after mount before the governor is allowed an opinion.
 *
 * Must clear the sprout-in *and* the shadow map's warm-up window with it
 * (`SHADOW_WARMUP_SECONDS` in `Atmosphere`), because during that window every
 * tree is drawn twice a frame and the first shader compiles are still landing.
 * Sampling into it reads as a machine that cannot cope, and the governor throws
 * away effects the GPU could hold comfortably -- measured, on hardware that runs
 * the full stack at 133fps, as a slide all the way to the bottom rung.
 */
const GOVERNOR_WARMUP = 4;
/** Seconds of quiet after a change, so a new rung's compile hitch is not what gets measured. */
const GOVERNOR_COOLDOWN = 1.5;
/** Consecutive comfortable windows required before climbing a rung. */
const CLIMB_WINDOWS = 3;
/**
 * Consecutive strained windows required before dropping a rung.
 *
 * Two, not one, and the median inside a window is not enough on its own: a
 * texture upload or a late shader compile can hold a whole window over the line
 * once. Measured, that showed up as a scene settling correctly on most loads and
 * throwing away two rungs on the rest, for no reason the frame after.
 */
const DROP_WINDOWS = 2;
/**
 * How far over the target a median frame may sit before a rung is rejected.
 *
 * The band between this and `CLIMB_TOLERANCE` is deliberately narrow, and both
 * ends are pinned by a real number. The floor: a display running at 60Hz pins a
 * *healthy* frame to 16.7ms, so a downgrade threshold at or below the target
 * would throw away effects on a machine that is keeping up perfectly. The
 * ceiling: on the hardware this was tuned against, the AO rung measures 18.3ms
 * against 11.7ms without it, and a threshold above that lets AO stay at 55fps.
 * 1.05 is the widest value that still rejects it, and the narrowest that still
 * accepts a clean 60Hz lock.
 */
const DOWNGRADE_TOLERANCE = 1.05;
/**
 * Vsync pins a healthy frame to the display's own cadence, so "has headroom" can
 * only ever mean "is keeping up" -- never "is faster than the target". Slightly
 * over 1 so a 60Hz machine sitting exactly on its cadence still qualifies.
 */
const CLIMB_TOLERANCE = 1.02;
/**
 * Where the highest rung this machine could actually hold is remembered.
 *
 * Its own key, in the same style as the site's dark-mode and language keys. The
 * point is the *second* visit: finding the ceiling means climbing one rung too
 * far and spending a second or two there, and there is no reason to make a
 * returning visitor sit through that discovery again.
 */
const QUALITY_STORAGE_KEY = "cv-orman-quality";

function readStoredCeiling(max: number): number | null {
  try {
    const raw = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    if (raw === null) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isInteger(value) && value >= 0 && value <= max ? value : null;
  } catch {
    // Private mode, or storage disabled. Measuring again is a fine fallback.
    return null;
  }
}

/**
 * Picks the post-processing rung by measuring the frame rate, because nothing
 * available before the first frame can predict it.
 *
 * The capability signals a browser exposes -- core count, device memory --
 * describe the CPU, and this scene is bound by the GPU almost entirely. The
 * machine this was calibrated on reports twelve cores and sixteen gigabytes,
 * selects the top preset on that basis, and renders it at four frames a second
 * on its integrated graphics. A governor sidesteps the whole question: start
 * somewhere reasonable, watch the real frame times, and walk down the ladder in
 * `EFFECT_LEVELS` until they come good.
 *
 * The median, not the mean: a single 300ms hitch from a texture upload drags a
 * mean far enough to trigger a downgrade the scene did not need.
 */
function PerfGovernor({
  level,
  maxLevel,
  onChange,
}: {
  level: number;
  maxLevel: number;
  onChange: (level: number) => void;
}) {
  const samples = useRef<number[]>([]);
  const elapsed = useRef(0);
  // Seeded past the warm-up so the *first* completed window is thrown away too.
  // Both counters tick from mount, so this buys one window of settling on top of
  // `GOVERNOR_WARMUP` -- which matters because that first window is the one most
  // likely to be holding a late shader compile, and a wrong verdict there is
  // written to storage and outlives the visit.
  const cooldown = useRef(GOVERNOR_WARMUP + 1);
  const comfortable = useRef(0);
  const strained = useRef(0);
  // Once a rung has proved too slow it is never tried again. Without this the
  // governor climbs straight back into the rung it just failed, fails again,
  // and oscillates forever -- visibly, since every change is a visible change.
  const ceiling = useRef(maxLevel);

  // Dev-only, alongside `__forestState`/`__forestControls`: which rung the scene
  // settled on is otherwise invisible, and it is the one number that says
  // whether this machine is getting the effects it can afford.
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    (window as unknown as { __forestQuality?: number }).__forestQuality = level;
  }, [level]);

  // Read in an effect rather than during render: the server has no storage, and
  // a value only this side knows about must not reach the first render.
  useEffect(() => {
    const stored = readStoredCeiling(maxLevel);
    if (stored === null) return;
    ceiling.current = stored;
    if (level > stored) onChange(stored);
    // Once, on mount -- `level` here is the opening rung the tier picked, and
    // the governor owns it from this point on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    elapsed.current += delta;
    cooldown.current -= delta;
    if (elapsed.current < GOVERNOR_WARMUP) return;

    const ms = delta * 1000;
    // A tab restored from the background, or a long GC, reports one enormous
    // delta that says nothing about the steady-state cost.
    if (ms > 0 && ms < 250) samples.current.push(ms);
    if (samples.current.length < GOVERNOR_WINDOW) return;

    const sorted = samples.current.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    samples.current.length = 0;
    if (cooldown.current > 0) return;

    if (median > TARGET_MS * DOWNGRADE_TOLERANCE && level > 0) {
      comfortable.current = 0;
      strained.current += 1;
      if (strained.current < DROP_WINDOWS) return;
      strained.current = 0;
      ceiling.current = level - 1;
      cooldown.current = GOVERNOR_COOLDOWN;
      try {
        window.localStorage.setItem(QUALITY_STORAGE_KEY, String(ceiling.current));
      } catch {
        // Storage refused. The governor still holds the ceiling for this visit.
      }
      onChange(level - 1);
      return;
    }
    strained.current = 0;

    if (median <= TARGET_MS * CLIMB_TOLERANCE && level < ceiling.current) {
      comfortable.current += 1;
      if (comfortable.current >= CLIMB_WINDOWS) {
        comfortable.current = 0;
        cooldown.current = GOVERNOR_COOLDOWN;
        onChange(level + 1);
      }
      return;
    }

    comfortable.current = 0;
  });

  return null;
}

/**
 * Warm halo on the ground under the hovered or selected tree.
 *
 * One mesh for the whole forest, moved to whichever tree is active rather than
 * one halo per tree. `toneMapped={false}` keeps it bright enough for the bloom
 * pass to catch.
 */
function HoverHalo({
  positions,
  hoveredIdRef,
  selectedIdRef,
}: {
  positions: Map<string, [number, number, number]>;
  hoveredIdRef: React.RefObject<string | null>;
  selectedIdRef: React.RefObject<string | null>;
}) {
  const ringRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshBasicMaterial>(null);
  const fade = useRef(0);

  useFrame(({ clock }, delta) => {
    const ring = ringRef.current;
    const material = materialRef.current;
    if (!ring || !material) return;

    const activeId = hoveredIdRef.current ?? selectedIdRef.current;
    fade.current = THREE.MathUtils.damp(fade.current, activeId !== null ? 1 : 0, 5, delta);

    if (activeId !== null) {
      const position = positions.get(activeId);
      // Kept in place while fading out, so clearing a selection dims the halo
      // where it stands instead of snapping it back to the origin.
      if (position) ring.position.set(position[0], position[1] + 0.06, position[2]);
    }

    const pulse = 1 + Math.sin(clock.elapsedTime * 2.2) * 0.04;
    ring.scale.setScalar(1.35 * pulse);
    material.opacity = fade.current * 0.55;
    ring.visible = fade.current > 0.005;
  });

  return (
    <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false} raycast={() => null}>
      <ringGeometry args={[0.7, 1, 48]} />
      <meshBasicMaterial
        ref={materialRef}
        color="#ffc978"
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
 * Sharp scene while nothing is selected; on selection the focus eases onto the
 * tree and the bokeh ramps up, so the valley melts into a backdrop behind the
 * repo being inspected. Driven per frame, never as a prop snap. Ultra tier only.
 */
function SelectionDOF({ focus }: { focus: SelectionFocusPoint | null }) {
  const effectRef = useRef<DepthOfFieldEffect | null>(null);
  const target = useRef(new THREE.Vector3(0, 2.4, 0));
  const bokeh = useRef(0);
  const reducedMotion = usePrefersReducedMotion();

  const DAMP_LAMBDA = 2.2;
  const BOKEH_MAX = 2.4;

  useFrame((_, delta) => {
    const effect = effectRef.current;
    if (!effect) return;

    const active = focus !== null;
    bokeh.current = reducedMotion
      ? active
        ? BOKEH_MAX
        : 0
      : THREE.MathUtils.damp(bokeh.current, active ? BOKEH_MAX : 0, DAMP_LAMBDA, delta);

    if (focus) {
      const [x, y, z] = focus.position;
      const goalY = y + 2.4 * focus.scale;
      if (reducedMotion) {
        target.current.set(x, goalY, z);
      } else {
        target.current.x = THREE.MathUtils.damp(target.current.x, x, DAMP_LAMBDA, delta);
        target.current.y = THREE.MathUtils.damp(target.current.y, goalY, DAMP_LAMBDA, delta);
        target.current.z = THREE.MathUtils.damp(target.current.z, z, DAMP_LAMBDA, delta);
      }
    }

    effect.target = target.current;
    effect.bokehScale = bokeh.current;
  });

  return <DepthOfField ref={effectRef} focusRange={7} bokehScale={0} />;
}
