"use client";

import { useSyncExternalStore } from "react";

export type QualityTier = "low" | "mid" | "high" | "ultra";

function detectTier(): QualityTier {
  if (typeof window === "undefined") return "mid";

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const reducedData = window.matchMedia("(prefers-reduced-data: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  if (reducedData || cores <= 4 || memory <= 2) return "low";
  // Ultra: big desktop-class machine. Deliberately strict -- it turns on the
  // most expensive effects (god rays, DOF, dpr up to 2.5), so a borderline
  // laptop should land on high, not ultra.
  if (cores >= 12 && memory >= 8 && !coarsePointer) return "ultra";
  if (cores >= 8 && memory >= 4 && !coarsePointer) return "high";
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
  multisampling: number;
  bloom: boolean;
  n8ao: boolean;
  vignette: boolean;
  /** Volumetric light shafts from the sun/moon -- the single most expensive effect. */
  godRays: boolean;
  /** Depth-of-field that focuses the selected tree. */
  dof: boolean;
  /** Low drifting mist layers hugging the terrain. */
  groundFog: boolean;
  /** Night-sky star dome. Cheap -- on everywhere. */
  stars: boolean;
  /** Airborne drifting-leaf particle count (0 = off). */
  leafDriftCount: number;
  shadowMapSize: number;
  dpr: [number, number];
  /** Terrain grid resolution per side. */
  terrainSegments: number;
  /** Environment density multipliers, consumed by ExhibitEnvironment. */
  grassDensity: number;
  /** Foliage clump count multiplier for species builds (1 = recipe default). */
  foliageDensity: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  low: {
    multisampling: 0,
    bloom: false,
    n8ao: false,
    vignette: true,
    godRays: false,
    dof: false,
    groundFog: false,
    stars: true,
    leafDriftCount: 0,
    shadowMapSize: 1024,
    dpr: [1, 1.5],
    terrainSegments: 128,
    grassDensity: 0.2,
    foliageDensity: 0.85,
  },
  mid: {
    multisampling: 2,
    bloom: true,
    n8ao: true,
    vignette: true,
    godRays: false,
    dof: false,
    groundFog: true,
    stars: true,
    leafDriftCount: 40,
    shadowMapSize: 1024,
    dpr: [1, 1.75],
    terrainSegments: 160,
    grassDensity: 0.35,
    foliageDensity: 1,
  },
  high: {
    multisampling: 2,
    bloom: true,
    n8ao: true,
    vignette: true,
    godRays: true,
    dof: false,
    groundFog: true,
    stars: true,
    leafDriftCount: 80,
    shadowMapSize: 2048,
    dpr: [1, 2],
    terrainSegments: 192,
    grassDensity: 0.46,
    foliageDensity: 1,
  },
  ultra: {
    multisampling: 4,
    bloom: true,
    n8ao: true,
    vignette: true,
    godRays: true,
    dof: true,
    groundFog: true,
    stars: true,
    leafDriftCount: 100,
    shadowMapSize: 2048,
    dpr: [1, 2],
    terrainSegments: 224,
    grassDensity: 0.52,
    foliageDensity: 1.15,
  },
};
