"use client";

import * as THREE from "three";

/**
 * Every texture in the exhibit is generated here, in code, at runtime.
 *
 * There are no image files in this project on purpose: the whole scene has to
 * ship with the page, stay deterministic between server and client, and carry
 * no licensing baggage. So bark, ground, water and leaf silhouettes are all
 * synthesized from a seeded value-noise lattice (or, for leaves, drawn with
 * canvas2d paths) the first time a material asks for them, then cached at
 * module scope for the lifetime of the tab.
 *
 * Everything here touches `document`/`DataTexture`, so it must only ever be
 * called from client components -- never at module evaluation time.
 */

// ---------------------------------------------------------------------------
// Seeded, wrapping value noise
// ---------------------------------------------------------------------------

function hash2(ix: number, iy: number, seed: number): number {
  let h = seed ^ Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise on a lattice that wraps every `period` units, so tiles seamlessly. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = smoothstep(x - x0);
  const fy = smoothstep(y - y0);

  const wrap = (v: number) => ((v % period) + period) % period;
  const xa = wrap(x0);
  const xb = wrap(x0 + 1);
  const ya = wrap(y0);
  const yb = wrap(y0 + 1);

  const n00 = hash2(xa, ya, seed);
  const n10 = hash2(xb, ya, seed);
  const n01 = hash2(xa, yb, seed);
  const n11 = hash2(xb, yb, seed);

  const top = n00 + (n10 - n00) * fx;
  const bottom = n01 + (n11 - n01) * fx;
  return top + (bottom - top) * fy;
}

interface FbmOptions {
  octaves?: number;
  gain?: number;
  lacunarity?: number;
  /** Anisotropic stretch: >1 stretches the pattern along y (vertical grain). */
  stretchY?: number;
}

/** Fractal sum of wrapping value noise. `u`/`v` are in [0,1); `period` sets the base lattice. */
function fbm(u: number, v: number, period: number, seed: number, opts: FbmOptions = {}): number {
  const { octaves = 4, gain = 0.5, lacunarity = 2, stretchY = 1 } = opts;
  let amplitude = 1;
  let total = 0;
  let norm = 0;
  let freq = period;
  for (let o = 0; o < octaves; o++) {
    total += valueNoise(u * freq, (v * freq) / stretchY, freq, seed + o * 7919) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }
  return total / norm;
}

/** Sharp-crested variant -- reads as cracks and ridges rather than soft clouds. */
function ridgedFbm(u: number, v: number, period: number, seed: number, opts: FbmOptions = {}): number {
  const n = fbm(u, v, period, seed, opts);
  return 1 - Math.abs(n * 2 - 1);
}

// ---------------------------------------------------------------------------
// Texture assembly
// ---------------------------------------------------------------------------

function finishTexture(texture: THREE.Texture, srgb: boolean): THREE.Texture {
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function dataTextureFrom(size: number, data: Uint8Array, srgb: boolean): THREE.Texture {
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  return finishTexture(texture, srgb);
}

/**
 * Height field -> tangent-space normal map, by central differences on the
 * wrapped grid. Cheaper and more controllable than authoring normals directly,
 * and guarantees the normal map matches whatever albedo the same field drove.
 */
function normalMapFromHeight(size: number, height: Float32Array, strength: number): THREE.Texture {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      // Normalize (-dx, -dy, 1) and pack into [0,255].
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round(((-dx / len) * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round(((-dy / len) * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((1 / len) * 0.5 * 255 + 127.5);
      data[i + 3] = 255;
    }
  }
  return dataTextureFrom(size, data, false);
}

export interface SurfaceTextures {
  /** Grayscale-ish detail albedo -- multiplied by the material's own base color. */
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/**
 * Build an albedo/normal/roughness set from one height field, so all three
 * agree. `shade` maps height to a brightness multiplier, `rough` maps it to a
 * roughness value.
 */
function surfaceFromHeight(
  size: number,
  height: Float32Array,
  options: { normalStrength: number; shade: (h: number) => number; rough: (h: number) => number },
): SurfaceTextures {
  const albedo = new Uint8Array(size * size * 4);
  const roughness = new Uint8Array(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    const h = height[i];
    const shade = Math.round(THREE.MathUtils.clamp(options.shade(h), 0, 1) * 255);
    albedo[i * 4] = shade;
    albedo[i * 4 + 1] = shade;
    albedo[i * 4 + 2] = shade;
    albedo[i * 4 + 3] = 255;

    // Standard material samples roughness from the green channel.
    const r = Math.round(THREE.MathUtils.clamp(options.rough(h), 0, 1) * 255);
    roughness[i * 4] = r;
    roughness[i * 4 + 1] = r;
    roughness[i * 4 + 2] = r;
    roughness[i * 4 + 3] = 255;
  }

  return {
    map: dataTextureFrom(size, albedo, true),
    normalMap: normalMapFromHeight(size, height, options.normalStrength),
    roughnessMap: dataTextureFrom(size, roughness, false),
  };
}

// ---------------------------------------------------------------------------
// Bark
// ---------------------------------------------------------------------------

/**
 * Bark character per species family. Silhouette alone can't carry eight
 * species at close range, so the trunk surface has to differ too: deep
 * furrows on an oak read nothing like a birch's papery bands.
 */
export type BarkKind = "furrowed" | "papery" | "plated" | "fibrous";

const BARK_SIZE = 256;
const barkCache = new Map<BarkKind, SurfaceTextures>();

function barkHeight(kind: BarkKind): Float32Array {
  const size = BARK_SIZE;
  const height = new Float32Array(size * size);
  const seed = { furrowed: 1301, papery: 2609, plated: 3907, fibrous: 5171 }[kind];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      let h: number;

      switch (kind) {
        case "furrowed": {
          // Deep vertical grooves: ridged noise stretched hard along the trunk
          // axis, with a coarse warp so the furrows wander instead of striping.
          const warp = fbm(u, v, 4, seed + 11, { octaves: 2, stretchY: 5 }) * 0.12;
          h = ridgedFbm(u + warp, v, 7, seed, { octaves: 4, stretchY: 6 });
          h = Math.pow(h, 1.7);
          break;
        }
        case "papery": {
          // Birch: near-flat with horizontal lenticel dashes and faint peel bands.
          const bands = fbm(u, v, 3, seed + 5, { octaves: 2, stretchY: 0.12 });
          const dashes = ridgedFbm(u, v, 26, seed + 31, { octaves: 2, stretchY: 0.08 });
          h = 0.72 + bands * 0.16 - Math.pow(dashes, 5) * 0.55;
          break;
        }
        case "plated": {
          // Conifer: irregular scaly plates separated by thin dark cracks.
          const plates = fbm(u, v, 9, seed, { octaves: 3, stretchY: 1.6 });
          const cracks = ridgedFbm(u, v, 11, seed + 17, { octaves: 3, stretchY: 1.4 });
          h = plates * 0.55 + Math.pow(cracks, 3) * 0.65;
          break;
        }
        default: {
          // Palm/willow: long stringy fibres running up the trunk.
          const fibres = ridgedFbm(u, v, 30, seed, { octaves: 3, stretchY: 14 });
          const coarse = fbm(u, v, 5, seed + 23, { octaves: 2, stretchY: 8 });
          h = fibres * 0.6 + coarse * 0.4;
          break;
        }
      }

      height[y * size + x] = THREE.MathUtils.clamp(h, 0, 1);
    }
  }
  return height;
}

export function getBarkTextures(kind: BarkKind): SurfaceTextures {
  const cached = barkCache.get(kind);
  if (cached) return cached;

  const height = barkHeight(kind);
  const contrast = kind === "papery" ? 0.3 : 0.62;
  const built = surfaceFromHeight(BARK_SIZE, height, {
    normalStrength: kind === "papery" ? 1.6 : 4.2,
    // Keep the albedo above ~0.45 so the species' own bark color still reads;
    // this map is detail, not the color itself.
    shade: (h) => 1 - contrast + h * contrast,
    rough: (h) => 0.96 - h * 0.22,
  });

  barkCache.set(kind, built);
  return built;
}

// ---------------------------------------------------------------------------
// Ground
// ---------------------------------------------------------------------------

const GROUND_SIZE = 256;
let groundCache: SurfaceTextures | null = null;

/**
 * One shared micro-detail set for the whole terrain. Which *kind* of ground a
 * spot reads as (turf, bare earth, gravel, riverbank) comes from the terrain
 * mesh's vertex colors -- this only supplies the grain that keeps a 200-unit
 * plane from looking like flat vinyl up close.
 */
export function getGroundTextures(): SurfaceTextures {
  if (groundCache) return groundCache;

  const size = GROUND_SIZE;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const clumps = fbm(u, v, 12, 811, { octaves: 4 });
      const grit = fbm(u, v, 48, 907, { octaves: 2 });
      height[y * size + x] = THREE.MathUtils.clamp(clumps * 0.7 + grit * 0.3, 0, 1);
    }
  }

  groundCache = surfaceFromHeight(size, height, {
    normalStrength: 2.6,
    shade: (h) => 0.62 + h * 0.38,
    rough: (h) => 0.98 - h * 0.16,
  });
  return groundCache;
}

// ---------------------------------------------------------------------------
// Water
// ---------------------------------------------------------------------------

let waterNormalCache: THREE.Texture | null = null;

/** Tiling ripple normal map. Two of these scroll against each other in Water.tsx. */
export function getWaterNormalTexture(): THREE.Texture {
  if (waterNormalCache) return waterNormalCache;

  const size = 128;
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      height[y * size + x] = fbm(u, v, 6, 4409, { octaves: 3, gain: 0.55 });
    }
  }

  waterNormalCache = normalMapFromHeight(size, height, 2.2);
  return waterNormalCache;
}

// ---------------------------------------------------------------------------
// Leaf atlas
// ---------------------------------------------------------------------------

/**
 * 2x2 atlas of leaf *clusters* -- not single leaves.
 *
 * Real-time foliage never bills one quad per leaf: each card carries a whole
 * sprig, so ~200 cards fill a canopy that would otherwise need thousands. The
 * shapes are drawn with canvas2d bezier paths from a seeded RNG, and the four
 * tiles differ enough in outline that a canopy built from them doesn't read as
 * one stamp repeated.
 *
 * Alpha is hard (0 or ~1) at the silhouette edge because the leaf material
 * uses alphaTest, not blending -- so there is no sorting, depth writes work,
 * and shadow maps come out right.
 */
export type LeafShape = "broad" | "needle" | "blossom" | "frond";

const leafAtlasCache = new Map<LeafShape, THREE.Texture>();

function drawBroadLeaf(ctx: CanvasRenderingContext2D, length: number, width: number) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(width, -length * 0.28, width * 0.75, -length * 0.8, 0, -length);
  ctx.bezierCurveTo(-width * 0.75, -length * 0.8, -width, -length * 0.28, 0, 0);
  ctx.closePath();
  ctx.fill();
}

function drawNeedleSpray(ctx: CanvasRenderingContext2D, length: number, count: number, rand: () => number) {
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const side = i % 2 === 0 ? 1 : -1;
    const angle = side * (0.5 + rand() * 0.35);
    const len = length * (0.45 + (1 - t) * 0.55) * (0.8 + rand() * 0.4);
    ctx.lineWidth = 2.2 + rand() * 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -t * length * 0.9);
    ctx.lineTo(Math.sin(angle) * len, -t * length * 0.9 - Math.cos(angle) * len * 0.5);
    ctx.stroke();
  }
}

function makeLeafTile(
  ctx: CanvasRenderingContext2D,
  originX: number,
  originY: number,
  tile: number,
  shape: LeafShape,
  seed: number,
) {
  let state = seed >>> 0;
  const rand = () => {
    state = (Math.imul(state ^ (state >>> 16), 2246822507) ^ 0x9e3779b9) >>> 0;
    return (state >>> 8) / 16777216;
  };

  ctx.save();
  ctx.translate(originX + tile / 2, originY + tile * 0.94);

  const sprigs = shape === "frond" ? 3 : shape === "needle" ? 7 : 9;
  for (let i = 0; i < sprigs; i++) {
    const spread = (i / (sprigs - 1) - 0.5) * 2;
    const lean = spread * (shape === "frond" ? 0.85 : 0.65) + (rand() - 0.5) * 0.3;
    const rise = tile * (shape === "frond" ? 0.55 : 0.38) * (0.55 + rand() * 0.6);

    ctx.save();
    ctx.translate(spread * tile * 0.3, -Math.abs(spread) * tile * 0.06 - rand() * tile * 0.05);
    ctx.rotate(lean);

    // Near-white with only a slight per-sprig value shift. The species' foliage
    // color arrives as the instance color and *multiplies* this, so anything
    // darker than near-white here compounds into near-black canopies -- the
    // atlas must carry silhouette and shading variation, not hue.
    const shade = 0.84 + rand() * 0.16;
    const c = Math.round(shade * 255);
    ctx.fillStyle = `rgb(${Math.round(c * 0.94)},${c},${Math.round(c * 0.88)})`;
    ctx.strokeStyle = ctx.fillStyle;

    switch (shape) {
      case "needle":
        drawNeedleSpray(ctx, rise * 1.4, 9, rand);
        break;
      case "frond": {
        // One long stem with paired blades: reads as a palm frond section.
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.quadraticCurveTo(rise * 0.15, -rise * 0.6, rise * 0.05, -rise * 1.25);
        ctx.stroke();
        for (let b = 0; b < 11; b++) {
          const t = b / 10;
          ctx.save();
          ctx.translate(rise * 0.12 * t, -rise * 1.2 * t);
          ctx.rotate((b % 2 === 0 ? 1 : -1) * (1.15 - t * 0.35));
          drawBroadLeaf(ctx, rise * 0.42 * (1 - t * 0.45), rise * 0.045);
          ctx.restore();
        }
        break;
      }
      case "blossom": {
        // Rounded petal clusters rather than pointed leaves.
        for (let p = 0; p < 6; p++) {
          ctx.save();
          ctx.rotate((p / 6) * Math.PI * 2 + rand() * 0.4);
          ctx.translate(0, -rise * 0.3);
          ctx.beginPath();
          ctx.ellipse(0, 0, rise * 0.19, rise * 0.26, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
        break;
      }
      default: {
        for (let l = 0; l < 4; l++) {
          ctx.save();
          ctx.rotate((l - 1.5) * 0.42 + (rand() - 0.5) * 0.2);
          drawBroadLeaf(ctx, rise * (0.7 + rand() * 0.45), rise * 0.3);
          ctx.restore();
        }
        break;
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Undergrowth and mist
// ---------------------------------------------------------------------------

let grassCache: THREE.Texture | null = null;

/** A single tuft of grass blades, alpha-cut. One card per tuft, thousands of tufts. */
export function getGrassTuft(): THREE.Texture {
  if (grassCache) return grassCache;

  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    ctx.clearRect(0, 0, size, size);
    ctx.lineCap = "round";
    let state = 20259;
    const rand = () => {
      state = (Math.imul(state ^ (state >>> 16), 2246822507) ^ 0x9e3779b9) >>> 0;
      return (state >>> 8) / 16777216;
    };

    for (let i = 0; i < 13; i++) {
      const rootX = size * (0.5 + (rand() - 0.5) * 0.72);
      const lean = (rand() - 0.5) * size * 0.42;
      const height = size * (0.45 + rand() * 0.5);
      // Near-white for the same reason as the leaf atlas: the material color
      // tints this, so brightness here is variation, not hue.
      const shade = Math.round(205 + rand() * 50);
      ctx.strokeStyle = `rgb(${Math.round(shade * 0.94)},${shade},${Math.round(shade * 0.86)})`;
      ctx.lineWidth = 1.6 + rand() * 2.4;
      ctx.beginPath();
      ctx.moveTo(rootX, size);
      ctx.quadraticCurveTo(rootX + lean * 0.4, size - height * 0.55, rootX + lean, size - height);
      ctx.stroke();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  grassCache = texture;
  return texture;
}

let mistCache: THREE.Texture | null = null;

/** Soft tiling noise used as the alpha of the drifting ground mist layers. */
export function getMistTexture(): THREE.Texture {
  if (mistCache) return mistCache;

  const size = 256;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const density = fbm(u, v, 4, 6113, { octaves: 4, gain: 0.55 });
      const i = (y * size + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      // Threshold well above the noise mean so the mist reads as detached banks
      // with clear gaps, not as an even wash across the whole plane.
      data[i + 3] = Math.round(THREE.MathUtils.clamp((density - 0.52) * 2.8, 0, 1) * 255);
    }
  }

  mistCache = dataTextureFrom(size, data, false);
  return mistCache;
}

export function getLeafAtlas(shape: LeafShape): THREE.Texture {
  const cached = leafAtlasCache.get(shape);
  if (cached) return cached;

  const tile = 256;
  const canvas = document.createElement("canvas");
  canvas.width = tile * 2;
  canvas.height = tile * 2;
  const ctx = canvas.getContext("2d");

  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const seedBase = { broad: 71, needle: 173, blossom: 281, frond: 397 }[shape];
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        makeLeafTile(ctx, tx * tile, ty * tile, tile, shape, seedBase + (ty * 2 + tx) * 9187);
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;

  leafAtlasCache.set(shape, texture);
  return texture;
}
