/**
 * Deterministic randomness for the voxel world.
 *
 * Nothing in the scene may call `Math.random()`: the same repo list has to
 * build the same island on every visit, or a visitor's "the big oak by the
 * bridge" is somewhere else after a refresh.
 */

/** Integer lattice hash -> [0, 1). */
export function hash3(x: number, y: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function hash2(x: number, z: number): number {
  return hash3(x, 7919, z);
}

/** String-seeded PRNG (mulberry-style). */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Smooth 2D value noise in [0, 1]. */
export function noise2(x: number, z: number, seed = 0): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fz * fz * (3 - 2 * fz);
  const a = hash3(xi, seed, zi);
  const b = hash3(xi + 1, seed, zi);
  const c = hash3(xi, seed, zi + 1);
  const d = hash3(xi + 1, seed, zi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Two-octave fractal noise in [0, 1]. */
export function fbm2(x: number, z: number, seed = 0): number {
  return noise2(x, z, seed) * 0.65 + noise2(x * 2.1 + 31.7, z * 2.1 - 17.3, seed + 1) * 0.35;
}
