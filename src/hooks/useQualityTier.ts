"use client";

import { useSyncExternalStore } from "react";

export type QualityTier = "low" | "mid" | "high";

function detectTier(): QualityTier {
  if (typeof window === "undefined") return "mid";

  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  const reducedData = window.matchMedia("(prefers-reduced-data: reduce)").matches;
  const coarsePointer = window.matchMedia("(pointer: coarse)").matches;

  if (reducedData || cores <= 4 || memory <= 2) return "low";
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

export const QUALITY_PRESETS = {
  low: {
    multisampling: 0,
    bloom: false,
    n8ao: false,
    vignette: true,
    shadowMapSize: 1024,
    dpr: [1, 1.5] as [number, number],
  },
  mid: {
    multisampling: 2,
    bloom: true,
    n8ao: true,
    vignette: true,
    shadowMapSize: 1024,
    dpr: [1, 1.75] as [number, number],
  },
  high: {
    multisampling: 4,
    bloom: true,
    n8ao: true,
    vignette: true,
    shadowMapSize: 2048,
    dpr: [1, 2] as [number, number],
  },
} as const;