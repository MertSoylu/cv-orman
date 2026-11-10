"use client";

import { useSyncExternalStore } from "react";

export type QualityTier = "low" | "mid" | "high" | "ultra";

/**
 * Static tier detection from CPU-side hints only (`WEBGL_debug_renderer_info`
 * is deliberately not read -- no GPU fingerprinting). Those hints say nothing
 * about the GPU, so the tier only picks a *starting point*; the engine's frame
 * governor in `world.ts` measures real frame times and gives up resolution and
 * bloom if the guess was too generous.
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
  /** Ceiling on devicePixelRatio. */
  dprMax: number;
  shadowMapSize: number;
  /** MSAA samples on the HDR buffer. Voxel edges are all hard edges, so this is the setting you see most. */
  multisampling: number;
  bloom: boolean;
  /** Multiplier on every airborne particle count. */
  particles: number;
  /** Multiplier on the wild planting (bushes, small trees). */
  decorDensity: number;
  clouds: number;
}

export const QUALITY_PRESETS: Record<QualityTier, QualityPreset> = {
  low: { dprMax: 1.25, shadowMapSize: 1024, multisampling: 0, bloom: false, particles: 0.4, decorDensity: 0.7, clouds: 6 },
  mid: { dprMax: 1.5, shadowMapSize: 2048, multisampling: 2, bloom: true, particles: 0.7, decorDensity: 1, clouds: 9 },
  high: { dprMax: 2, shadowMapSize: 2048, multisampling: 4, bloom: true, particles: 1, decorDensity: 1, clouds: 12 },
  ultra: { dprMax: 2, shadowMapSize: 4096, multisampling: 4, bloom: true, particles: 1.3, decorDensity: 1.15, clouds: 14 },
};
