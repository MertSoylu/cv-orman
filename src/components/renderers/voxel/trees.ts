import type { Species } from "@/lib/forest/treeData";
import { clamp, hash3, seededRandom, smoothstep } from "./math";
import { Volume, rgbOf } from "./volume";

/**
 * The eight species, sculpted voxel by voxel.
 *
 * Growth does **not** scale a tree -- it sizes it. A voxel world has one voxel
 * size, so a bigger repo gets a taller trunk and a wider crown made of more
 * cubes, never the same model stretched. Health works the same way: a thirsty
 * tree does not merely fade, it turns autumn one voxel at a time and then
 * starts dropping them, so "hasn't been touched in months" is legible from
 * across the island as a thin, rust-coloured crown.
 *
 * Every species has to be recognisable by silhouette alone, at the size of a
 * thumbnail. The knobs carrying that are trunk height against crown width,
 * where the crown starts, and whether foliage is a blob, a stack of tiers, a
 * curtain or a spray of fronds.
 */

export const BARK = 1;
export const LEAF = 2;
export const FRUIT = 3;

type Rng = () => number;

class Sculpt {
  readonly ids = new Map<number, number>();
  readonly births = new Map<number, number>();

  static key(x: number, y: number, z: number): number {
    return ((x + 64) << 14) | ((z + 64) << 7) | (y + 8);
  }

  put(x: number, y: number, z: number, id: number, birth: number, force = false): void {
    x = Math.round(x);
    y = Math.round(y);
    z = Math.round(z);
    if (y < 0 || y > 110 || Math.abs(x) > 60 || Math.abs(z) > 60) return;
    const k = Sculpt.key(x, y, z);
    if (!force && this.ids.has(k)) return;
    this.ids.set(k, id);
    this.births.set(k, clamp(birth, 0, 1));
  }

  has(x: number, y: number, z: number): boolean {
    return this.ids.has(Sculpt.key(x, y, z));
  }

  /** A tapered wooden limb from a to b. */
  limb(a: number[], b: number[], r0: number, r1: number, birth0: number, birth1: number): void {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const steps = Math.max(1, Math.ceil(len * 2));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = a[0] + (b[0] - a[0]) * t;
      const cy = a[1] + (b[1] - a[1]) * t;
      const cz = a[2] + (b[2] - a[2]) * t;
      const r = r0 + (r1 - r0) * t;
      const reach = Math.ceil(r);
      const birth = birth0 + (birth1 - birth0) * t;
      for (let dx = -reach; dx <= reach; dx++)
        for (let dz = -reach; dz <= reach; dz++) {
          if (dx * dx + dz * dz > r * r + 0.3) continue;
          this.put(cx + dx, cy, cz + dz, BARK, birth, true);
        }
    }
  }

  /** A lumpy ellipsoid of foliage. `rough` eats into the surface; `power` > 2 squares it off. */
  blob(c: number[], rx: number, ry: number, rz: number, birth0: number, birth1: number, rough: number, salt: number, power = 2): void {
    for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++)
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++)
        for (let dz = -Math.ceil(rz); dz <= Math.ceil(rz); dz++) {
          const x = Math.round(c[0]) + dx;
          const y = Math.round(c[1]) + dy;
          const z = Math.round(c[2]) + dz;
          const d =
            Math.pow(Math.abs(dx / rx), power) + Math.pow(Math.abs(dy / ry), power) + Math.pow(Math.abs(dz / rz), power);
          const h = hash3(x + salt, y, z - salt);
          const limit = 1 - rough * h;
          if (d > limit * limit) continue;
          this.put(x, y, z, LEAF, birth0 + (birth1 - birth0) * (0.55 * Math.min(1, d) + 0.45 * h));
        }
  }
}

function roots(s: Sculpt, rng: Rng, reach: number): void {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    if (rng() < 0.25) continue;
    s.put(dx * reach, 0, dz * reach, BARK, 0.02, true);
    if (reach > 1) s.put(dx, 1, dz, BARK, 0.05, true);
  }
}

function oak(s: Sculpt, f: number, rng: Rng, salt: number): void {
  const th = Math.round(5 + 4 * f);
  const thick = f > 1.12;
  const top = [Math.round(rng() * 2 - 1), th, Math.round(rng() * 2 - 1)];
  s.limb([0, 0, 0], top, thick ? 1 : 0.5, thick ? 0.8 : 0.5, 0, 0.45);
  roots(s, rng, thick ? 2 : 1);
  const branches = 3 + (f > 1.1 ? 1 : 0);
  const a0 = rng() * Math.PI * 2;
  const reach = 1.5 + 1.6 * f;
  for (let i = 0; i < branches; i++) {
    const a = a0 + (i / branches) * Math.PI * 2 + (rng() - 0.5) * 0.6;
    const from = [top[0], Math.round(th * (0.62 + rng() * 0.2)), top[2]];
    const tip = [from[0] + Math.cos(a) * reach, from[1] + reach * 0.7, from[2] + Math.sin(a) * reach];
    s.limb(from, tip, 0.5, 0.5, 0.35, 0.55);
    const r = 1.8 + 0.9 * f;
    s.blob(tip, r, r * 0.78, r, 0.55, 1, 0.32, salt + i * 13);
  }
  const r = 2.6 + 1.6 * f;
  s.blob([top[0], th + 1.5 + f, top[2]], r, r * 0.72, r, 0.5, 1, 0.3, salt);
}

function pine(s: Sculpt, f: number, rng: Rng, salt: number): void {
  const height = Math.round(9 + 7 * f);
  s.limb([0, 0, 0], [0, height - 2, 0], 0.5, 0.5, 0, 0.6);
  const y0 = 3;
  const rMax = 2.2 + 1.6 * f;
  for (let y = y0; y <= height; y++) {
    const p = (y - y0) / (height - y0);
    const saw = (2 - ((y - y0) % 3)) * 0.6;
    const r = rMax * (1 - p) * 0.8 + saw * (1 - p * 0.7);
    const reach = Math.ceil(r);
    for (let dx = -reach; dx <= reach; dx++)
      for (let dz = -reach; dz <= reach; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > r) continue;
        if (d > r - 1 && hash3(dx + salt, y, dz) < 0.22) continue;
        s.put(dx, y, dz, LEAF, 0.2 + 0.7 * p + 0.1 * (d / (r + 0.01)));
      }
  }
  s.put(0, height + 1, 0, LEAF, 0.97);
  if (rng() < 0.6) s.put(0, height + 2, 0, LEAF, 1);
}

function redwood(s: Sculpt, f: number, rng: Rng, salt: number): void {
  const height = Math.round(15 + 8 * f);
  const a = Math.round(height * 0.34);
  const b = Math.round(height * 0.7);
  s.limb([0, 0, 0], [0, a, 0], 1.45, 1.05, 0, 0.2);
  s.limb([0, a, 0], [0, b, 0], 1, 0.9, 0.2, 0.45);
  s.limb([0, b, 0], [0, height - 1, 0], 0.5, 0.5, 0.45, 0.65);
  for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [-1, -2]]) {
    if (rng() < 0.3) continue;
    s.put(dx, 0, dz, BARK, 0.02, true);
    s.put(dx, 1, dz, BARK, 0.05, true);
  }
  const y0 = Math.round(height * 0.48);
  const rMax = 2.5 + 0.9 * f;
  for (let y = y0; y <= height; y++) {
    const p = (y - y0) / (height - y0);
    const tier = (y - y0) % 4;
    const r = tier === 3 ? 1.3 : rMax * (1 - p * 0.72) * (1 - tier * 0.13);
    const reach = Math.ceil(r);
    for (let dx = -reach; dx <= reach; dx++)
      for (let dz = -reach; dz <= reach; dz++) {
        const d = Math.hypot(dx, dz);
        if (d > r) continue;
        if (d > r - 1 && hash3(dx + salt, y, dz) < 0.3) continue;
        s.put(dx, y, dz, LEAF, 0.4 + 0.55 * p);
      }
  }
  s.put(0, height + 1, 0, LEAF, 1);
}

function sakura(s: Sculpt, f: number, rng: Rng, salt: number): void {
  const th = Math.round(3 + 2.2 * f);
  const a0 = rng() * Math.PI * 2;
  const top = [Math.round(Math.cos(a0) * 1.2), th, Math.round(Math.sin(a0) * 1.2)];
  const thick = f > 1.1;
  s.limb([0, 0, 0], top, thick ? 1 : 0.5, 0.5, 0, 0.35);
  roots(s, rng, 1);
  const limbs = 3 + (f > 1 ? 1 : 0);
  const reach = 2 + 1.6 * f;
  for (let i = 0; i < limbs; i++) {
    const a = a0 + (i / limbs) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const tip = [top[0] + Math.cos(a) * reach, th + 1.6 + f + rng(), top[2] + Math.sin(a) * reach];
    const mid = [top[0] + Math.cos(a) * reach * 0.55, th + 0.6, top[2] + Math.sin(a) * reach * 0.55];
    s.limb(top, mid, 0.5, 0.5, 0.3, 0.45);
    s.limb(mid, tip, 0.5, 0.5, 0.45, 0.6);
    const r = 2.2 + 0.9 * f;
    s.blob(tip, r, r * 0.6, r, 0.55, 1, 0.38, salt + i * 7);
  }
  const r = 2.5 + 1.1 * f;
  s.blob([top[0], th + 2.6 + f, top[2]], r, r * 0.6, r, 0.55, 1, 0.38, salt + 99);
}

function birch(s: Sculpt, f: number, _rng: Rng, salt: number): void {
  const height = Math.round(8 + 6 * f);
  s.limb([0, 0, 0], [0, height - 1, 0], 0.5, 0.5, 0, 0.6);
  const r = 1.9 + 0.9 * f;
  const ry = 2.2 + 0.6 * f;
  s.blob([0, height * 0.56, 0], r, ry, r, 0.45, 0.8, 0.5, salt);
  s.blob([0, height * 0.78, 0], r * 0.92, ry, r * 0.92, 0.6, 0.9, 0.5, salt + 5);
  s.blob([0, height * 0.98, 0], r * 0.62, ry * 0.8, r * 0.62, 0.75, 1, 0.45, salt + 11);
}

function willow(s: Sculpt, f: number, rng: Rng, salt: number): void {
  const th = Math.round(5 + 3 * f);
  const thick = f > 1.05;
  const top = [Math.round(rng() * 2 - 1), th, Math.round(rng() * 2 - 1)];
  s.limb([0, 0, 0], top, thick ? 1 : 0.5, thick ? 0.8 : 0.5, 0, 0.4);
  roots(s, rng, thick ? 2 : 1);
  const rx = 3.4 + 1.8 * f;
  const ry = 2 + 0.9 * f;
  const cy = th + 1;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + rng();
    s.limb(top, [top[0] + Math.cos(a) * rx * 0.55, cy + 1, top[2] + Math.sin(a) * rx * 0.55], 0.5, 0.5, 0.35, 0.5);
  }
  // Dome: the upper part of an ellipsoid only.
  for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++)
    for (let dz = -Math.ceil(rx); dz <= Math.ceil(rx); dz++)
      for (let dy = -1; dy <= Math.ceil(ry); dy++) {
        const d = (dx * dx + dz * dz) / (rx * rx) + (dy * dy) / (ry * ry);
        const h = hash3(dx + salt, dy, dz);
        if (d > (1 - 0.25 * h) ** 2) continue;
        s.put(top[0] + dx, cy + dy, top[2] + dz, LEAF, 0.5 + 0.3 * h);
      }
  // Curtain: strands hanging from the dome's skirt, stopping short of the ground.
  for (let dx = -Math.ceil(rx); dx <= Math.ceil(rx); dx++)
    for (let dz = -Math.ceil(rx); dz <= Math.ceil(rx); dz++) {
      const d = Math.hypot(dx, dz) / rx;
      if (d < 0.55 || d > 1.02) continue;
      const h = hash3(dx - salt, 3, dz + salt);
      if (h > 0.55) continue;
      const length = Math.round(2 + (h / 0.55) * (2.5 + 3 * f) * (0.5 + d * 0.5));
      for (let i = 1; i <= length; i++) {
        const y = cy - 1 - i;
        if (y < 2) break;
        s.put(top[0] + dx, y, top[2] + dz, LEAF, 0.75 + 0.25 * (i / length));
      }
    }
}

function palm(s: Sculpt, f: number, rng: Rng): void {
  const height = Math.round(8 + 5 * f);
  const a = rng() * Math.PI * 2;
  const lean = 2 + 1.5 * f;
  let px = 0;
  let pz = 0;
  for (let y = 0; y <= height; y++) {
    const off = lean * (y / height) ** 2;
    const x = Math.round(Math.cos(a) * off);
    const z = Math.round(Math.sin(a) * off);
    if (x !== px || z !== pz) s.put(px, y, pz, BARK, (y / height) * 0.55, true);
    s.put(x, y, z, BARK, (y / height) * 0.55, true);
    px = x;
    pz = z;
  }
  const top = [px, height, pz];
  s.put(top[0], height + 1, top[2], LEAF, 0.6);
  const fronds = 8;
  const length = 3.4 + 2.2 * f;
  const a1 = rng() * Math.PI;
  for (let i = 0; i < fronds; i++) {
    const fa = a1 + (i / fronds) * Math.PI * 2 + (rng() - 0.5) * 0.3;
    const dx = Math.cos(fa);
    const dz = Math.sin(fa);
    const droop = 2.4 + rng() * 1.4;
    for (let t = 0.5; t <= length; t += 0.5) {
      const u = t / length;
      const y = height + 1 + 2.2 * u * (1 - u) * 1.6 - droop * u * u;
      const birth = 0.6 + 0.4 * u;
      s.put(top[0] + dx * t, y, top[2] + dz * t, LEAF, birth);
      if (u > 0.18 && u < 0.72) {
        s.put(top[0] + dx * t - dz, y, top[2] + dz * t + dx, LEAF, birth);
        s.put(top[0] + dx * t + dz, y, top[2] + dz * t - dx, LEAF, birth);
      }
    }
  }
  for (const [dx, dz] of [[1, 0], [0, 1], [-1, 0]]) {
    if (rng() < 0.3) continue;
    s.put(top[0] + dx, height - 1, top[2] + dz, FRUIT, 0.95, true);
  }
}

function generic(s: Sculpt, f: number, rng: Rng, salt: number): void {
  const th = Math.round(4 + 3 * f);
  const thick = f > 1.2;
  s.limb([0, 0, 0], [0, th + 1, 0], thick ? 1 : 0.5, 0.5, 0, 0.45);
  roots(s, rng, 1);
  const a = 2.3 + 1.3 * f;
  const b = a * 0.9;
  s.blob([0, th + b - 0.5, 0], a, b, a, 0.45, 1, 0.14, salt, 4);
}

const BUILDERS: Record<Species, (s: Sculpt, f: number, rng: Rng, salt: number) => void> = {
  oak, pine, redwood, sakura, birch, willow, palm, generic,
};

interface Palette {
  bark: [number, number, number];
  barkAlt: [number, number, number];
  leaves: [number, number, number][];
  /** Chance a healthy leaf voxel takes the accent colour instead (blossom highlights). */
  accentChance: number;
  accent: [number, number, number];
  fruit: [number, number, number];
  /** How bark picks its alternate colour: random flecks (birch), rings (palm), or sparse grain. */
  barkStyle: "grain" | "flecks" | "rings";
}

function palette(bark: string, barkAlt: string, leaves: string[], barkStyle: Palette["barkStyle"] = "grain", accent = "#ffffff", accentChance = 0): Palette {
  return {
    bark: rgbOf(bark),
    barkAlt: rgbOf(barkAlt),
    leaves: leaves.map(rgbOf),
    accentChance,
    accent: rgbOf(accent),
    fruit: rgbOf("#5b3a22"),
    barkStyle,
  };
}

const PALETTES: Record<Species, Palette> = {
  oak: palette("#6e4b2f", "#5d3e26", ["#4f8f3a", "#5fa244", "#437d33"]),
  pine: palette("#5b3e29", "#4c3322", ["#2d6a49", "#27593f", "#377a52"]),
  redwood: palette("#96503a", "#7f4130", ["#3c7446", "#33653d", "#488350"]),
  sakura: palette("#4f3833", "#42302c", ["#f3a3bf", "#f7bcd0", "#ec8cae"], "grain", "#fff3f6", 0.14),
  birch: palette("#ece6d8", "#3b3632", ["#a2c84e", "#b5d660", "#8fb843"], "flecks"),
  willow: palette("#6c5b3c", "#5a4b31", ["#84a94f", "#97ba5d", "#739a45"]),
  palm: palette("#a17f54", "#876841", ["#4fa24c", "#3f9046", "#62b356"], "rings"),
  generic: palette("#70523a", "#5e4430", ["#3f9a72", "#4aab80", "#358663"]),
};

// The legend's health ramp, as voxels: straw, then rust, then bark-brown.
const DRY: [number, number, number][] = [rgbOf("#d9a441"), rgbOf("#c8762b"), rgbOf("#8a5a2b")];

export type VoxelColor = (id: number, x: number, y: number, z: number, face: number, out: number[]) => void;

function treeColor(species: Species, healthStage: number, salt: number): VoxelColor {
  const pal = PALETTES[species];
  const wilt = 1 - clamp(healthStage, 0, 1);
  const dryFraction = smoothstep(0.08, 0.72, wilt) * 0.96;
  return (id, x, y, z, _face, out) => {
    let c: [number, number, number];
    const h = hash3(x * 3 + salt, y * 3 + 1, z * 3 - salt);
    if (id === BARK) {
      const alt =
        pal.barkStyle === "rings" ? y % 2 === 0 : pal.barkStyle === "flecks" ? h < 0.17 : h < 0.3;
      c = alt ? pal.barkAlt : pal.bark;
    } else if (id === FRUIT) {
      c = pal.fruit;
    } else {
      const h2 = hash3(x - salt, y * 5 + 2, z + salt * 3);
      if (h < dryFraction) {
        const t = h2 + wilt * 0.75;
        c = t < 0.62 ? DRY[0] : t < 1.05 ? DRY[1] : DRY[2];
      } else if (h2 < pal.accentChance) {
        c = pal.accent;
      } else {
        c = pal.leaves[Math.floor(h2 * 2.999)];
      }
    }
    const jitter = 0.94 + 0.12 * hash3(x + 11, y - 5 + salt, z + 3);
    out[0] = c[0] * jitter;
    out[1] = c[1] * jitter;
    out[2] = c[2] * jitter;
  };
}

export interface TreeModel {
  volume: Volume;
  color: VoxelColor;
  /** Height in voxels, from the ground. */
  height: number;
  /** Horizontal half-extent of the crown. */
  radius: number;
  /** A few leaf positions (local), for the petals and leaves that fall from this tree. */
  leafSamples: number[][];
  /** Linear colour of what falls: blossom, or the dry palette. */
  dropColor: [number, number, number];
  /** How much falls, 0..1. */
  dropRate: number;
}

const NEIGHBOURS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

export function buildTree(id: string, species: Species, growthScore: number, healthStage: number): TreeModel {
  const rng = seededRandom(`tree:${id}`);
  const salt = Math.floor(rng() * 9973);
  const f = 0.78 + 0.7 * clamp(growthScore, 0, 1);
  const s = new Sculpt();
  BUILDERS[species](s, f, rng, salt);

  // Hollow the crowns: a leaf sealed in on all six sides is never seen.
  const sealed: number[] = [];
  const cells: { x: number; y: number; z: number; k: number; id: number }[] = [];
  for (const [k, vid] of s.ids) {
    const x = (k >> 14) - 64;
    const z = ((k >> 7) & 127) - 64;
    const y = (k & 127) - 8;
    cells.push({ x, y, z, k, id: vid });
    if (vid === LEAF && NEIGHBOURS.every(([dx, dy, dz]) => s.has(x + dx, y + dy, z + dz))) sealed.push(k);
  }
  for (const k of sealed) s.ids.delete(k);

  // A thirsty tree drops leaves.
  const wilt = 1 - clamp(healthStage, 0, 1);
  const drop = Math.max(0, wilt - 0.22) * 0.72;
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0, maxY = 0;
  const kept: typeof cells = [];
  for (const cell of cells) {
    if (!s.ids.has(cell.k)) continue;
    if (cell.id === LEAF && hash3(cell.x + salt, cell.y * 7, cell.z - salt) < drop) continue;
    kept.push(cell);
    minX = Math.min(minX, cell.x);
    maxX = Math.max(maxX, cell.x);
    minZ = Math.min(minZ, cell.z);
    maxZ = Math.max(maxZ, cell.z);
    maxY = Math.max(maxY, cell.y);
  }

  const volume = new Volume(maxX - minX + 1, maxY + 1, maxZ - minZ + 1, minX, 0, minZ);
  volume.aux = new Uint8Array(volume.data.length);
  const leafSamples: number[][] = [];
  for (const cell of kept) {
    const i = volume.index(cell.x, cell.y, cell.z);
    volume.data[i] = cell.id;
    volume.aux[i] = Math.round((s.births.get(cell.k) ?? 0) * 255);
    if (cell.id === LEAF && hash3(cell.x, cell.y + salt, cell.z) < 0.08) leafSamples.push([cell.x + 0.5, cell.y, cell.z + 0.5]);
  }

  const pal = PALETTES[species];
  const blossom = species === "sakura";
  return {
    volume,
    color: treeColor(species, healthStage, salt),
    height: maxY + 1,
    radius: Math.max(maxX, -minX, maxZ, -minZ) + 0.5,
    leafSamples,
    dropColor: wilt > 0.3 ? DRY[wilt > 0.6 ? 1 : 0] : blossom ? pal.leaves[1] : pal.leaves[0],
    dropRate: blossom ? Math.max(0.55, wilt) : smoothstep(0.25, 0.8, wilt),
  };
}
