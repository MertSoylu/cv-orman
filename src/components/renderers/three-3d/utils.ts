"use client";

import * as THREE from "three";

/**
 * Deterministic string hash -> [0,1) generator.
 *
 * Seeded determinism is load-bearing here, not a style choice: every source of
 * visual variation in the scene (which variant a tree gets, its yaw, where a
 * fern sits, which rock is where) must be a pure function of a stable seed like
 * `tree.id`, or the server render and the client render disagree and React
 * throws a hydration error. `Math.random()` is banned scene-wide.
 */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state ^= state >>> 16;
    return (state >>> 0) / 4294967296;
  };
}

/** Map a [0,1] value to a [min,max] range. */
export function lerpRange(t: number, min: number, max: number): number {
  return min + (max - min) * t;
}

/**
 * growthScore (0-1, floored at GROWTH.MIN_GROWTH_FLOOR) -> overall tree scale.
 *
 * The range is deliberately narrower than a naive 0.2x-2x: species already
 * differ in height by a factor of two, so a wide growth range on top of that
 * made small repos read as saplings of an unrelated species rather than as
 * smaller members of the same forest.
 *
 * The floor also has a second job. `trees/decor.ts` caps the unlabelled filler
 * below it, so this is the value that guarantees every repo tree -- even a
 * brand-new repo with no stars -- outgrows the wood it stands in. Lower it and
 * the smallest repos start disappearing into the scenery.
 */
const SCALE_MIN = 0.82;
const SCALE_MAX = 1.5;

export function growthToScale(growthScore: number): number {
  return lerpRange(THREE.MathUtils.clamp(growthScore, 0, 1), SCALE_MIN, SCALE_MAX);
}

/**
 * healthStage (0-1, floored at HEALTH.WILTED_FLOOR) -> [0,1] "wiltedness".
 * healthStage never reaches 0, so this never returns a fully dead tree --
 * only "most wilted, still clearly foliage".
 */
export function wiltAmount(healthStage: number): number {
  return 1 - THREE.MathUtils.clamp(healthStage, 0, 1);
}

/** Shared dry palette every species wilts toward. Mirrors the legend gradient in the overlay. */
export const DRY_PALETTE = {
  light: new THREE.Color("#d9a441"),
  dark: new THREE.Color("#8a5a2b"),
};

const LUMINANCE_THRESHOLD = 0.5;

/**
 * Interpolate a species' healthy foliage color toward the dry palette as health
 * drops, picking the dry target by luminance so dark conifer greens go brown
 * and pale blossoms go straw -- one flat wilt target made every species
 * converge on the same mud.
 */
export function healthyToWilted(healthyColor: THREE.Color, healthStage: number): THREE.Color {
  const wilt = wiltAmount(healthStage);
  const luminance = healthyColor.r * 0.299 + healthyColor.g * 0.587 + healthyColor.b * 0.114;
  const target = luminance > LUMINANCE_THRESHOLD ? DRY_PALETTE.light : DRY_PALETTE.dark;
  return healthyColor.clone().lerp(target, wilt * 0.85);
}

// Sprout-in intro. Staggered by growthScore so the big landmark trees rise
// first and the forest assembles in order of prominence rather than all at once.
const INTRO_DURATION = 1.05;
const INTRO_MAX_DELAY = 1.6;
const INTRO_BACK_OVERSHOOT = 1.05;

/**
 * Mount-intro scale multiplier for one tree: 0 before its stagger delay, then
 * an easeOutBack ramp to 1. Pure function of elapsed seconds and growthScore,
 * so it can be evaluated straight into the tree-state texture.
 */
export function introProgress(elapsed: number, growthScore: number): number {
  const delay = (1 - THREE.MathUtils.clamp(growthScore, 0, 1)) * INTRO_MAX_DELAY;
  const t = THREE.MathUtils.clamp((elapsed - delay) / INTRO_DURATION, 0, 1);
  const u = t - 1;
  return 1 + (INTRO_BACK_OVERSHOOT + 1) * u * u * u + INTRO_BACK_OVERSHOOT * u * u;
}

/**
 * Pointer cursor while a tree or plaque is under the pointer.
 *
 * The canvas has no DOM elements to hang `cursor: pointer` on, so hit-testing
 * inside the scene has to drive the page's cursor directly. Callers must reset
 * it on unmount, or a stuck pointer cursor outlives the scene.
 */
export function setHoverCursor(active: boolean): void {
  if (typeof document === "undefined") return;
  document.body.style.cursor = active ? "pointer" : "auto";
}

/** Smooth 0..1 ramp, matching GLSL `smoothstep`. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
