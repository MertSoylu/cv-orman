"use client";

import { useSyncExternalStore } from "react";

export type QualityTier = "low" | "mid" | "high" | "ultra";

/**
 * Static tier detection, and what it is *not* allowed to decide.
 *
 * `hardwareConcurrency` and `deviceMemory` describe the CPU. They say nothing
 * about the GPU, and this scene is bound almost entirely by the GPU: a laptop
 * with twelve cores, sixteen gigabytes and Intel integrated graphics reports
 * exactly the same numbers as a workstation with a discrete card, and measured
 * ten frames a second on the preset those numbers selected.
 *
 * So the tier chosen here only sets *structural* load -- geometry counts, terrain
 * resolution, foliage density -- which is cheap enough to be survivable even when
 * the guess is wrong (the full ultra scene renders at ~100fps on that same Iris Xe
 * with the post-processing stack off). Everything expensive and GPU-bound lives in
 * `EFFECT_LEVELS`, which is chosen by measuring real frame times instead.
 */
function detectTier(): QualityTier {
  if (typeof window === "undefined") return "mid";

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const reducedData = window.matchMedia("(prefers-reduced-data: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  if (reducedData || cores <= 4 || memory <= 2) return "low";
  if (coarsePointer) return "mid";
  if (cores >= 12 && memory >= 8) return "ultra";
  if (cores >= 8 && memory >= 4) return "high";
  return "mid";
}

let cachedTier: QualityTier | null = null;

function getSnapshot(): QualityTier {
  if (cachedTier === null) cachedTier = detectTier();
  return cachedTier;
}

function subscribe(onStoreChange: () => void): () => void {
  const mql = window.matchMedia("(pointer: coarse)");
  mql.addEventListener("change", onStoreChange);
  return () => {
    mql.removeEventListener("change", onStoreChange);
    cachedTier = null;
  };
}

export function useQualityTier(): QualityTier {
  return useSyncExternalStore(subscribe, getSnapshot, () => "mid" as QualityTier);
}

export interface QualityPreset {
  /** Drifting mist layers hugging the terrain. */
  groundFog: boolean;
  /**
   * Whether trees ever draw their alpha-tested leaf cards. False collapses the
   * foliage LOD permanently to the cheap canopy hull -- the single biggest fill
   * rate saving available, and the first thing to go on weak hardware.
   */
  detailedLeaves: boolean;
  /** Airborne firefly/pollen particle count (0 = off). */
  moteCount: number;
  shadowMapSize: number;
  dpr: [number, number];
  /** Terrain grid resolution per side. */
  terrainSegments: number;
  /** Target instance counts for ground cover. */
  grassCount: number;
  detailCount: number;
  /** Reed clumps in the stream shallows. Bank stones scale off this too. */
  reedCount: number;
  /** Lily pads and the mist lying over the channel -- both pure fill rate. */
  waterDetail: boolean;
  /** Unlabelled filler trees that turn a short repo list into a forest. Free -- they share the repo trees' instancing buckets. */
  decorTrees: number;
  /** Leaf-card count multiplier for species builds (1 = recipe default). */
  foliageDensity: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  low: {
    groundFog: false,
    detailedLeaves: false,
    moteCount: 0,
    shadowMapSize: 1024,
    dpr: [1, 1.5],
    terrainSegments: 96,
    grassCount: 900,
    detailCount: 90,
    reedCount: 70,
    waterDetail: false,
    decorTrees: 30,
    foliageDensity: 0.6,
  },
  mid: {
    groundFog: true,
    detailedLeaves: true,
    moteCount: 50,
    shadowMapSize: 1024,
    dpr: [1, 1.75],
    terrainSegments: 144,
    grassCount: 2600,
    detailCount: 220,
    reedCount: 200,
    waterDetail: true,
    decorTrees: 80,
    foliageDensity: 0.85,
  },
  high: {
    groundFog: true,
    detailedLeaves: true,
    moteCount: 90,
    shadowMapSize: 2048,
    dpr: [1, 2],
    terrainSegments: 192,
    grassCount: 5200,
    detailCount: 380,
    reedCount: 340,
    waterDetail: true,
    decorTrees: 140,
    foliageDensity: 1,
  },
  ultra: {
    groundFog: true,
    detailedLeaves: true,
    moteCount: 130,
    shadowMapSize: 2048,
    dpr: [1, 2],
    terrainSegments: 224,
    grassCount: 8000,
    detailCount: 520,
    reedCount: 460,
    waterDetail: true,
    decorTrees: 190,
    foliageDensity: 1.15,
  },
};

/**
 * One rung of the post-processing ladder.
 *
 * Everything in here is screen-space and therefore priced in fill rate rather
 * than in triangles, which is why it is picked by measurement (see
 * `PerfGovernor` in `Forest3D`) and not by the static tier above. On the machine
 * this ladder was calibrated against, the full scene geometry -- 850k triangles,
 * shadows, eight thousand grass tufts -- costs 10ms a frame, and the effect stack
 * on top of it cost 35. AO alone was 30 of those 35, which is why it sits at the
 * very top of the ladder and is the first thing to go.
 */
export interface EffectLevel {
  multisampling: number;
  bloom: boolean;
  /** Screen-space ambient occlusion. By far the most expensive rung; measured ~30ms/frame on integrated graphics even at half resolution and minimum sample counts. */
  n8ao: boolean;
  /** Volumetric light shafts from the sun/moon. */
  godRays: boolean;
  /** Depth-of-field that focuses the selected tree. */
  dof: boolean;
  vignette: boolean;
  /** Multiplier applied to the tier's own dpr ceiling. Only the bottom rungs cut it -- resolution is the last thing to give up, because it costs sharpness everywhere at once. */
  dprScale: number;
  /**
   * Whether trees are still allowed their alpha-tested leaf cards.
   *
   * Only the bottom rung takes this away, and it is the one rung that changes
   * the scene rather than the picture of it -- canopies fall back to their
   * far-LOD hulls everywhere, at every distance. It sits here rather than in the
   * structural preset so that a machine which cannot hold 60fps even with the
   * whole effect stack off has one more thing left to give up.
   */
  detailedLeaves: boolean;
}

/**
 * Cheapest rung first. The governor walks this in single steps, so adjacent
 * rungs must differ by *one* visible thing -- a rung that drops two effects at
 * once can only ever overshoot.
 */
export const EFFECT_LEVELS: EffectLevel[] = [
  { multisampling: 0, bloom: false, n8ao: false, godRays: false, dof: false, vignette: true, dprScale: 0.7, detailedLeaves: false },
  { multisampling: 0, bloom: false, n8ao: false, godRays: false, dof: false, vignette: true, dprScale: 0.7, detailedLeaves: true },
  { multisampling: 0, bloom: false, n8ao: false, godRays: false, dof: false, vignette: true, dprScale: 1, detailedLeaves: true },
  { multisampling: 0, bloom: true, n8ao: false, godRays: false, dof: false, vignette: true, dprScale: 1, detailedLeaves: true },
  { multisampling: 2, bloom: true, n8ao: false, godRays: false, dof: false, vignette: true, dprScale: 1, detailedLeaves: true },
  { multisampling: 2, bloom: true, n8ao: false, godRays: true, dof: false, vignette: true, dprScale: 1, detailedLeaves: true },
  { multisampling: 2, bloom: true, n8ao: true, godRays: true, dof: false, vignette: true, dprScale: 1, detailedLeaves: true },
  { multisampling: 4, bloom: true, n8ao: true, godRays: true, dof: true, vignette: true, dprScale: 1, detailedLeaves: true },
];

/**
 * Where each tier *starts* on that ladder.
 *
 * Deliberately below the top even for `ultra`: the governor can climb in a few
 * seconds if the GPU turns out to have the headroom, and a first impression that
 * starts smooth and gets prettier is a much better one than a first impression
 * that starts at four frames a second and recovers.
 */
export const START_EFFECT_LEVEL: Record<QualityTier, number> = {
  low: 2,
  mid: 4,
  high: 5,
  ultra: 5,
};
