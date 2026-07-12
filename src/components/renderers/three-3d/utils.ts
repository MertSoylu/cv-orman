"use client";

import * as THREE from "three";

/**
 * Deterministic string hash -> [0,1) generator. Seeds per-tree jitter from
 * `tree.id` so layout looks organic but is stable across re-renders instead
 * of re-rolling random values every frame.
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
 * growthScore (0-1, floors at config GROWTH.MIN_GROWTH_FLOOR = 0.15) ->
 * overall tree scale multiplier. ~0.4x at the floor up to ~1.6x at 1.0,
 * so the 8 fixture trees read as clearly different sizes side by side.
 */
const SCALE_MIN = 0.4;
const SCALE_MAX = 1.6;

export function growthToScale(growthScore: number): number {
  const t = THREE.MathUtils.clamp(growthScore, 0, 1);
  return lerpRange(t, SCALE_MIN, SCALE_MAX);
}

/**
 * healthStage (0-1, floors at config HEALTH.WILTED_FLOOR = 0.15) -> [0,1]
 * "wiltedness" used to lerp a species' healthy foliage color toward a
 * shared dry/autumnal palette. At the floor this returns ~1 (max wilt) but
 * healthStage never reaches 0, so callers should never render a bare/dead
 * state -- only "most wilted, still clearly foliage."
 */
export function wiltAmount(healthStage: number): number {
  const t = THREE.MathUtils.clamp(healthStage, 0, 1);
  return 1 - t;
}

// Grow-in intro: how long one tree takes to scale 0 -> 1, and how far the
// start of the smallest tree's animation lags behind the biggest one's.
// Staggered by growthScore (big trees sprout first) so the exhibit reads as
// the forest assembling in order of prominence.
const INTRO_DURATION = 0.9;
const INTRO_MAX_DELAY = 1.4;
// easeOutBack overshoot -- peaks ~9% past final scale, a springy "sprout"
// settle instead of a linear inflate.
const INTRO_BACK_OVERSHOOT = 1.2;

/**
 * Mount-intro scale multiplier for one tree: 0 before its stagger delay,
 * eases (with a slight overshoot) to 1 over INTRO_DURATION after it. Pure
 * function of elapsed-seconds-since-mount + growthScore so Tree3D (foliage)
 * and TrunkInstanceGroup (bark) compute the identical curve for a tree from
 * their own independent useFrame clocks.
 */
export function introProgress(elapsed: number, growthScore: number): number {
  const delay = (1 - THREE.MathUtils.clamp(growthScore, 0, 1)) * INTRO_MAX_DELAY;
  const t = THREE.MathUtils.clamp((elapsed - delay) / INTRO_DURATION, 0, 1);
  const u = t - 1;
  return 1 + (INTRO_BACK_OVERSHOOT + 1) * u * u * u + INTRO_BACK_OVERSHOOT * u * u;
}

/** Shared dry/brown/yellowed target palette every species wilts toward. */
export const DRY_PALETTE = {
  light: new THREE.Color("#d9a441"), // dry straw/yellow
  dark: new THREE.Color("#8a5a2b"), // dry brown
};

/**
 * Interpolate a species' healthy color toward the shared dry palette as
 * health drops. Picks a dry target by luminance of the healthy color so
 * darker healthy greens (pine) drift toward dry brown and lighter ones
 * (sakura blossom pink, birch) drift toward dry straw -- keeps the
 * transition visually plausible per species instead of one flat target.
 */
const LUMINANCE_THRESHOLD = 0.5;

export function healthyToWilted(healthyColor: THREE.Color, healthStage: number): THREE.Color {
  const wilt = wiltAmount(healthStage);
  const luminance = healthyColor.r * 0.299 + healthyColor.g * 0.587 + healthyColor.b * 0.114;
  const target = luminance > LUMINANCE_THRESHOLD ? DRY_PALETTE.light : DRY_PALETTE.dark;
  return healthyColor.clone().lerp(target, wilt * 0.85);
}
