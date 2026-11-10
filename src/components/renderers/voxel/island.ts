import { LAYOUT } from "@/lib/config";
import { planSpiral, spiralAdvance, spiralNormalAt, spiralPointAt, spiralRadiusAt, spiralTangentAt, streamCoords, streamMeanderAt } from "@/lib/forest/path";
import { clamp, fbm2, hash2, hash3, lerp, noise2, smoothstep } from "./math";
import { Volume, rgbOf } from "./volume";
import type { VoxelColor } from "./trees";

/**
 * The floating island, generated from nothing but the tree positions.
 *
 * The island has no fixed size: its outline is the spiral walk's own outer
 * envelope plus a margin, so three repos get a hillock with a pond on it and
 * sixty get a mesa, and neither has a bald half. Everything on it is cells in
 * one `Volume` -- ground, path, planters, lanterns, the cabin, the flowers --
 * so it all meshes in one pass, shares one ambient-occlusion solve and costs
 * two draw calls (solid + emissive).
 *
 * There are two kinds of thing on the island and they must stay tellable
 * apart. The **exhibit** is built: the walk, the brick planters squared to the
 * grid, a sign and a lantern for each. The **wild** is seeded: bushes, flower
 * drifts, small trees, all hash-placed and all kept shorter than the smallest
 * repo tree, so a specimen is never mistaken for scenery.
 */

export const T = {
  GRASS: 1, DIRT: 2, STONE: 3, STONE_DARK: 4, PATH: 5, COBBLE: 6, SAND: 7, WATER: 8, PLANK: 9, WOOD: 10,
  BRICK: 11, SOIL: 12, LEAF_A: 13, LEAF_B: 14, FLOWER_R: 15, FLOWER_Y: 16, FLOWER_W: 17, FLOWER_P: 18,
  TUFT: 19, MUSHROOM: 20, GLOW: 21, CRYSTAL: 22, GATE: 23, ROOF: 24, WALL: 25, WINDOW: 26, VINE: 27,
  PUMPKIN: 28, ORE: 29, SIGN: 30, // SIGN..SIGN+4: one per health tier
} as const;

export const isEmissive = (id: number): boolean => id === T.GLOW || id === T.CRYSTAL || id === T.WINDOW;
export const isWater = (id: number): boolean => id === T.WATER;

const C = {
  grass: [rgbOf("#6aa64a"), rgbOf("#7cb956"), rgbOf("#5a9443"), rgbOf("#8bbf58")],
  dirt: rgbOf("#8b5e3c"),
  stone: rgbOf("#928a7e"),
  stoneDeep: rgbOf("#5b5650"),
  stoneDark: rgbOf("#6f685f"),
  path: [rgbOf("#dfcca4"), rgbOf("#d2bd92"), rgbOf("#e7d7b3")],
  cobble: rgbOf("#a59c8e"),
  sand: rgbOf("#e2d2a2"),
  plank: [rgbOf("#b47d47"), rgbOf("#a36f3d")],
  wood: rgbOf("#5a3f2a"),
  brick: [rgbOf("#c2b9aa"), rgbOf("#aea596")],
  soil: rgbOf("#5f4131"),
  leafA: [rgbOf("#5b9c41"), rgbOf("#6aad4b"), rgbOf("#4e8a39")],
  leafB: [rgbOf("#2f6b48"), rgbOf("#387a52"), rgbOf("#285c3e")],
  flowers: [rgbOf("#e5484d"), rgbOf("#f2c94c"), rgbOf("#f8f4ec"), rgbOf("#a970d6")],
  tuft: rgbOf("#559640"),
  mushroom: rgbOf("#d94a3d"),
  glow: [1.0, 0.62, 0.24] as [number, number, number],
  crystal: [0.3, 0.85, 1.0] as [number, number, number],
  window: [1.0, 0.72, 0.32] as [number, number, number],
  gate: rgbOf("#c2562f"),
  roof: [rgbOf("#a64b2d"), rgbOf("#913f26")],
  wall: rgbOf("#e8d8b4"),
  vine: rgbOf("#4c8c3c"),
  pumpkin: rgbOf("#e38a2b"),
  ore: rgbOf("#e0b64a"),
  // The legend's health ramp, fresh to thirsty.
  sign: [rgbOf("#6fae4f"), rgbOf("#a9b84a"), rgbOf("#d9a441"), rgbOf("#c8762b"), rgbOf("#8a5a2b")],
};

/** Face colours for island voxels. Shared by the main island, the islets and the clouds' neighbours. */
export const terrainColor: VoxelColor = (id, x, y, z, face, out) => {
  let c: [number, number, number];
  let jitter = 0.08;
  const h = hash3(x, y, z);
  switch (id) {
    case T.GRASS: {
      // Broad drifts of slightly different turf, so the lawn is not one flat green.
      const n = fbm2(x * 0.06, z * 0.06, 3);
      const a = C.grass[n < 0.5 ? 0 : 1];
      const b = C.grass[n < 0.5 ? 2 : 3];
      const t = h < 0.3 ? 1 : 0;
      c = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      if (face !== 2) c = [c[0] * 0.82, c[1] * 0.84, c[2] * 0.8];
      break;
    }
    case T.DIRT: c = C.dirt; jitter = 0.14; break;
    case T.STONE: {
      const depth = clamp(-y / 40, 0, 1);
      c = [lerp(C.stone[0], C.stoneDeep[0], depth), lerp(C.stone[1], C.stoneDeep[1], depth), lerp(C.stone[2], C.stoneDeep[2], depth)];
      jitter = 0.12;
      break;
    }
    case T.STONE_DARK: c = C.stoneDark; jitter = 0.12; break;
    case T.PATH: c = C.path[Math.floor(h * 2.999)]; jitter = 0.04; break;
    case T.COBBLE: c = C.cobble; jitter = 0.16; break;
    case T.SAND: c = C.sand; break;
    case T.PLANK: c = C.plank[(x + z) & 1]; break;
    case T.WOOD: c = C.wood; jitter = 0.12; break;
    case T.BRICK: c = C.brick[(x + y + z) & 1]; jitter = 0.05; break;
    case T.SOIL: c = C.soil; jitter = 0.14; break;
    case T.LEAF_A: c = C.leafA[Math.floor(h * 2.999)]; break;
    case T.LEAF_B: c = C.leafB[Math.floor(h * 2.999)]; break;
    case T.FLOWER_R: c = C.flowers[0]; break;
    case T.FLOWER_Y: c = C.flowers[1]; break;
    case T.FLOWER_W: c = C.flowers[2]; break;
    case T.FLOWER_P: c = C.flowers[3]; break;
    case T.TUFT: c = C.tuft; jitter = 0.16; break;
    case T.MUSHROOM: c = C.mushroom; break;
    case T.GLOW: c = C.glow; jitter = 0; break;
    case T.CRYSTAL: c = C.crystal; jitter = 0.2; break;
    case T.WINDOW: c = C.window; jitter = 0; break;
    case T.GATE: c = C.gate; jitter = 0.05; break;
    case T.ROOF: c = C.roof[(y + z) & 1]; break;
    case T.WALL: c = C.wall; jitter = 0.04; break;
    case T.VINE: c = C.vine; jitter = 0.14; break;
    case T.PUMPKIN: c = C.pumpkin; break;
    case T.ORE: c = C.ore; break;
    default: c = C.sign[clamp(id - T.SIGN, 0, 4)]; jitter = 0.03;
  }
  const k = 1 - jitter / 2 + jitter * hash3(x + 17, y + 31, z - 5);
  out[0] = c[0] * k;
  out[1] = c[1] * k;
  out[2] = c[2] * k;
};

export interface IslandTree {
  id: string;
  x: number;
  z: number;
  healthStage: number;
}

export interface PointLight {
  x: number;
  y: number;
  z: number;
  r: number;
}

export interface Island {
  volume: Volume;
  /** Outer radius of the island, for camera, shadow and cloud sizing. */
  radius: number;
  /** Height of the summit. */
  summit: number;
  /** Lowest stalactite. */
  bottom: number;
  /** World Y each tree's trunk starts at. */
  treeBase: Map<string, number>;
  lights: PointLight[];
  /** Where the stream leaves the island: top of the fall, and the outward direction. */
  waterfall: { x: number; y: number; z: number; dx: number; dz: number } | null;
  /** Chimney top, if the island had room for the cabin. */
  chimney: [number, number, number] | null;
  /** Top surface of a column (world Y), or null off the island. */
  surfaceAt: (x: number, z: number) => number | null;
  /** Baked lantern light at a world point. */
  lightAt: (x: number, y: number, z: number) => number;
}

const RIM_MARGIN = 13;
const POND_RADIUS = 5.6;
const STREAM_HALF = 1.5;
const EMPTY = -32768;

export function buildIsland(trees: IslandTree[], decorDensity: number): Island {
  const plan = planSpiral(trees.length);
  const thetaEnd = plan.thetaEnd;
  const rEnd = spiralRadiusAt(thetaEnd);
  const endAngle = thetaEnd % (Math.PI * 2);
  const TAU = Math.PI * 2;

  // The coast follows the spiral's outer loop, eased across the step where the walk ends.
  const edgeRadius = (phi: number): number => {
    const delta = (((endAngle - phi) % TAU) + TAU) % TAU;
    const along = spiralRadiusAt(Math.max(0, thetaEnd - delta));
    const r = lerp(along, rEnd, smoothstep(TAU - 1.2, TAU, delta));
    const coast = (fbm2(Math.cos(phi) * 2.6 + 9, Math.sin(phi) * 2.6 - 4, 7) - 0.5) * 8;
    return Math.max(r, LAYOUT.SPIRAL_START_RADIUS + 5) + RIM_MARGIN + coast;
  };

  let rMax = 0;
  for (let i = 0; i < 360; i++) rMax = Math.max(rMax, edgeRadius((i / 360) * TAU));
  const half = Math.ceil(rMax) + 3;
  const depthMax = clamp(Math.round(rMax * 0.62), 20, 50);
  const domeH = clamp(Math.round(rMax * 0.085), 3, 7);
  const size = half * 2 + 1;
  const yMin = -(depthMax + 22);
  const vol = new Volume(size, depthMax + 22 + domeH + 24, size, -half, yMin, -half);
  const col = (x: number, z: number) => (z + half) * size + (x + half);
  const inGrid = (x: number, z: number) => Math.abs(x) <= half && Math.abs(z) <= half;

  // --- Distance fields the rest of the build reads -------------------------------------------
  const pathDist = new Float32Array(size * size).fill(99);
  const plotDist = new Float32Array(size * size).fill(99);
  const stamp = (field: Float32Array, px: number, pz: number, reach: number, chebyshev = false) => {
    const x0 = Math.floor(px - reach), x1 = Math.ceil(px + reach);
    const z0 = Math.floor(pz - reach), z1 = Math.ceil(pz + reach);
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (!inGrid(x, z)) continue;
        const dx = x + 0.5 - px, dz = z + 0.5 - pz;
        const d = chebyshev ? Math.max(Math.abs(dx), Math.abs(dz)) : Math.hypot(dx, dz);
        const i = col(x, z);
        if (d < field[i]) field[i] = d;
      }
  };
  for (let theta = 0; theta < thetaEnd; theta = spiralAdvance(theta, 0.35)) {
    const p = spiralPointAt(theta);
    stamp(pathDist, p.x, p.y, 9);
  }
  // A spur from the walk's inner end down to the pond's shore.
  const start = spiralPointAt(0);
  for (let t = 0; t <= 1; t += 0.03) stamp(pathDist, start.x * lerp(1, 0.42, t), start.y * lerp(1, 0.42, t), 9);
  const gatePoint = spiralPointAt(thetaEnd);
  const gateTangent = spiralTangentAt(thetaEnd);
  const gateNormal = spiralNormalAt(thetaEnd);
  for (let dx = -3; dx <= 3; dx++)
    for (let dz = -3; dz <= 3; dz++) {
      // A small paved apron beyond the gate, so the walk ends in a place rather than a line.
      const px = gatePoint.x + gateTangent.x * 3.5 + dx, pz = gatePoint.y + gateTangent.y * 3.5 + dz;
      if (Math.hypot(dx, dz) <= 3.2 && inGrid(Math.floor(px), Math.floor(pz))) {
        const i = col(Math.floor(px), Math.floor(pz));
        pathDist[i] = Math.min(pathDist[i], 1);
      }
    }
  for (const tree of trees) stamp(plotDist, tree.x + 0.5, tree.z + 0.5, 10, true);

  const streamAngleEdge = edgeRadius(LAYOUT.STREAM_ANGLE);
  const waterLevelAt = (along: number) => Math.round(domeH * (1 - (clamp(along, 0, streamAngleEdge) / streamAngleEdge) ** 2));

  // --- Columns: ground, soil, rock, stalactites ----------------------------------------------
  const top = new Int16Array(size * size).fill(EMPTY);
  const wet = new Uint8Array(size * size);
  let bottomMost = 0;
  for (let z = -half; z <= half; z++)
    for (let x = -half; x <= half; x++) {
      const cx = x + 0.5, cz = z + 0.5;
      const r = Math.hypot(cx, cz);
      const e = edgeRadius(Math.atan2(cz, cx));
      if (r > e) continue;
      const t = r / e;
      const i = col(x, z);
      const sc = streamCoords(cx, cz);
      const across = Math.abs(sc.across);
      const inPond = r < POND_RADIUS + (noise2(cx * 0.5, cz * 0.5, 11) - 0.5) * 1.6;
      const inStream = sc.along >= 0 && across <= STREAM_HALF;
      const nearWater = r < POND_RADIUS + 2.2 || (sc.along >= 0 && across <= STREAM_HALF + 1.6);
      const level = r < POND_RADIUS + 2.2 ? domeH : waterLevelAt(sc.along);

      const calm =
        smoothstep(3.5, 8, pathDist[i]) * smoothstep(4.5, 8.5, plotDist[i]) *
        (sc.along >= 0 ? smoothstep(3, 7, across) : 1) * smoothstep(8, 13, r);
      let h = Math.round(domeH * (1 - t * t) + (fbm2(cx * 0.085, cz * 0.085, 5) - 0.5) * 4.2 * calm);
      if (nearWater) h = level;

      const thickness =
        3 + depthMax * Math.pow(1 - Math.pow(t, 1.5), 1.7) * (0.62 + 0.76 * fbm2(cx * 0.055, cz * 0.055, 9)) +
        Math.max(0, noise2(cx * 0.3, cz * 0.3, 21) - 0.66) * 30 * (1 - t * 0.6);
      const b = h - Math.round(thickness);
      bottomMost = Math.min(bottomMost, b);

      const soilDepth = 2 + Math.floor(hash2(x, z) * 2.4);
      for (let y = b; y <= h; y++) {
        const d = h - y;
        let id: number = T.STONE;
        if (d === 0) id = T.GRASS;
        else if (d <= soilDepth) id = T.DIRT;
        else if (noise2(x * 0.16 + y * 0.31, z * 0.16 - y * 0.23, 13) > 0.63) id = T.STONE_DARK;
        else if (hash3(x, y, z) < 0.012) id = T.ORE;
        vol.set(x, y, z, id);
      }
      top[i] = h;

      if (inPond || inStream) {
        vol.set(x, h, z, 0);
        vol.set(x, h - 1, z, T.WATER);
        vol.set(x, h - 2, z, T.SAND);
        wet[i] = inPond ? 2 : 1;
        top[i] = h - 2;
      } else if (nearWater && hash2(x + 5, z - 3) < 0.45) {
        vol.set(x, h, z, hash2(x, z + 9) < 0.5 ? T.SAND : T.COBBLE);
      }

      // Crystals hanging in the dark under the island: the only light down there at night.
      if (thickness > 9 && hash2(x * 3 + 2, z * 3 - 1) < 0.006) {
        const len = 2 + Math.floor(hash2(x - 7, z + 7) * 4);
        for (let k = 1; k <= len; k++) vol.set(x, b - k, z, T.CRYSTAL);
        if (len > 2) {
          vol.fill(x + 1, b - 1, z, T.CRYSTAL);
          vol.fill(x, b - 1, z + 1, T.CRYSTAL);
        }
        bottomMost = Math.min(bottomMost, b - len);
      }
    }

  const groundTop = (x: number, z: number): number => (inGrid(x, z) ? top[col(x, z)] : EMPTY);
  const isDry = (x: number, z: number): boolean => inGrid(x, z) && top[col(x, z)] !== EMPTY && wet[col(x, z)] === 0;

  // --- The walk, and the bridges that carry it over the stream -------------------------------
  for (let z = -half; z <= half; z++)
    for (let x = -half; x <= half; x++) {
      const i = col(x, z);
      const h = top[i];
      if (h === EMPTY) continue;
      const d = pathDist[i];
      if (wet[i] === 1 && d <= 2.3) {
        const deck = h + 2;
        vol.set(x, deck, z, T.PLANK);
        if (d > 1.55) {
          if (((x + z) & 1) === 0) vol.set(x, deck + 1, z, T.WOOD);
          vol.set(x, deck + 2, z, T.WOOD);
        }
      } else if (wet[i] === 0) {
        if (d <= 1.75) vol.set(x, h, z, T.PATH);
        else if (d <= 2.6 && hash2(x - 11, z + 4) < 0.28) vol.set(x, h, z, T.COBBLE);
      }
    }

  const lights: PointLight[] = [];

  // --- One planter, sign and gap in the kerb per tree ----------------------------------------
  const treeBase = new Map<string, number>();
  for (const tree of trees) {
    const hc = Math.max(groundTop(tree.x, tree.z), 0);
    for (let dx = -3; dx <= 3; dx++)
      for (let dz = -3; dz <= 3; dz++) {
        const x = tree.x + dx, z = tree.z + dz;
        if (!inGrid(x, z) || wet[col(x, z)]) continue;
        const ring = Math.max(Math.abs(dx), Math.abs(dz)) === 3;
        for (let y = hc + 2; y <= hc + 12; y++) vol.set(x, y, z, 0);
        const from = top[col(x, z)] === EMPTY ? hc - 4 : Math.min(top[col(x, z)], hc);
        for (let y = from; y < hc; y++) if (vol.get(x, y, z) === 0 || vol.get(x, y, z) === T.GRASS) vol.set(x, y, z, T.DIRT);
        vol.set(x, hc, z, ring ? T.BRICK : T.SOIL);
        vol.set(x, hc + 1, z, ring ? T.BRICK : 0);
        top[col(x, z)] = ring ? hc + 1 : hc;
      }
    treeBase.set(tree.id, hc + 1);

    // The sign stands on whichever side of the planter faces the walk.
    let best = [1, 0];
    let bestDist = Infinity;
    for (const dir of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = tree.x + dir[0] * 4, z = tree.z + dir[1] * 4;
      const d = inGrid(x, z) ? pathDist[col(x, z)] : 99;
      if (d < bestDist) {
        bestDist = d;
        best = dir;
      }
    }
    const sx = tree.x + best[0] * 4, sz = tree.z + best[1] * 4;
    if (isDry(sx, sz) && pathDist[col(sx, sz)] > 1.8) {
      const hs = top[col(sx, sz)];
      vol.set(sx, hs + 1, sz, T.WOOD);
      vol.set(sx, hs + 2, sz, T.WOOD);
      const tier = T.SIGN + clamp(Math.floor(((1 - tree.healthStage) / 0.85) * 4.99), 0, 4);
      for (let k = -1; k <= 1; k++) {
        vol.set(sx + best[1] * k, hs + 3, sz + best[0] * k, tier);
        vol.set(sx + best[1] * k, hs + 4, sz + best[0] * k, tier);
      }
      // Open the kerb behind the sign: a way in.
      vol.set(tree.x + best[0] * 3, hc + 1, tree.z + best[1] * 3, 0);
    }
  }

  // --- Lanterns down the walk ----------------------------------------------------------------
  const lantern = (px: number, pz: number): void => {
    const x = Math.floor(px), z = Math.floor(pz);
    if (!isDry(x, z) || pathDist[col(x, z)] < 2 || plotDist[col(x, z)] < 3.6) return;
    const sc = streamCoords(x + 0.5, z + 0.5);
    if (sc.along >= 0 && Math.abs(sc.across) < 3.2) return;
    const h = top[col(x, z)];
    for (let k = 1; k <= 3; k++) vol.set(x, h + k, z, T.WOOD);
    vol.set(x, h + 4, z, T.GLOW);
    top[col(x, z)] = h + 4;
    lights.push({ x: x + 0.5, y: h + 4.5, z: z + 0.5, r: 10 });
  };
  plan.stations.forEach((station, index) => {
    const theta = spiralAdvance(station.theta, LAYOUT.STATION_SPACING / 2);
    if (theta > thetaEnd) return;
    const p = spiralPointAt(theta);
    const n = spiralNormalAt(theta);
    const side = index % 2 === 0 ? 1 : -1;
    lantern(p.x + n.x * side * 3.3, p.y + n.y * side * 3.3);
  });
  lantern(start.x * 0.55 + 3, start.y * 0.55 + 3);

  // --- The gate: two clay pillars and a double beam, where the walk begins -------------------
  {
    const gx = gatePoint.x, gz = gatePoint.y;
    const base = Math.max(groundTop(Math.floor(gx), Math.floor(gz)), 0);
    const pillars: number[][] = [];
    for (const side of [-1, 1]) {
      const x = Math.floor(gx + gateNormal.x * side * 3.4), z = Math.floor(gz + gateNormal.y * side * 3.4);
      if (!isDry(x, z)) continue;
      for (let y = top[col(x, z)] + 1; y <= base + 8; y++) vol.set(x, y, z, T.GATE);
      vol.set(x, top[col(x, z)] + 1, z, T.COBBLE);
      pillars.push([x, z]);
      const lx = Math.floor(gx + gateNormal.x * side * 4.4), lz = Math.floor(gz + gateNormal.y * side * 4.4);
      vol.set(lx, base + 5, lz, T.GLOW);
      lights.push({ x: lx + 0.5, y: base + 5.5, z: lz + 0.5, r: 11 });
    }
    if (pillars.length === 2) {
      const beam = (y: number, overhang: number, id: number) => {
        const len = 6.8 + overhang * 2;
        for (let s = 0; s <= len; s += 0.4) {
          const k = s - len / 2;
          vol.set(Math.floor(gx + gateNormal.x * k), y, Math.floor(gz + gateNormal.y * k), id);
        }
      };
      beam(base + 7, 1.4, T.GATE);
      beam(base + 9, 2.6, T.WOOD);
    }
  }

  // --- The cabin, wherever the island has the most room for it -------------------------------
  let chimney: Island["chimney"] = null;
  {
    let best: number[] | null = null;
    let bestClear = 5.4;
    for (let r = 12; r < rMax - 8; r += 2.5)
      for (let phi = 0; phi < TAU; phi += 0.12) {
        const x = Math.round(Math.cos(phi) * r), z = Math.round(Math.sin(phi) * r);
        if (!inGrid(x, z) || top[col(x, z)] === EMPTY) continue;
        const sc = streamCoords(x, z);
        const clear = Math.min(
          pathDist[col(x, z)] - 3, plotDist[col(x, z)] - 4.5,
          sc.along >= 0 ? Math.abs(sc.across) - 4 : 99,
          edgeRadius(phi) - r - 6,
        );
        if (clear > bestClear) {
          bestClear = clear;
          best = [x, z];
        }
      }
    if (best) {
      const [bx, bz] = best;
      const hc = top[col(bx, bz)];
      for (let dx = -4; dx <= 4; dx++)
        for (let dz = -4; dz <= 4; dz++) {
          const x = bx + dx, z = bz + dz;
          if (!inGrid(x, z) || wet[col(x, z)]) continue;
          for (let y = hc + 1; y <= hc + 14; y++) vol.set(x, y, z, 0);
          for (let y = hc - 3; y < hc; y++) vol.fill(x, y, z, T.DIRT);
          const inside = Math.abs(dx) <= 3 && Math.abs(dz) <= 2;
          vol.set(x, hc, z, inside ? T.COBBLE : T.GRASS);
          top[col(x, z)] = hc;
          plotDist[col(x, z)] = 0;
          if (!inside) continue;
          const corner = Math.abs(dx) === 3 && Math.abs(dz) === 2;
          for (let y = hc + 1; y <= hc + 3; y++) vol.set(x, y, z, corner ? T.WOOD : T.WALL);
          top[col(x, z)] = hc + 3;
        }
      // Door and windows on the long faces; the gable runs along X.
      vol.set(bx, hc + 1, bz + 2, T.WOOD);
      vol.set(bx, hc + 2, bz + 2, T.WOOD);
      for (const [dx, dz] of [[-2, 2], [2, 2], [-2, -2], [0, -2], [2, -2]]) {
        vol.set(bx + dx, hc + 2, bz + dz, T.WINDOW);
        lights.push({ x: bx + dx + 0.5, y: hc + 2.5, z: bz + dz + (dz > 0 ? 1.5 : -0.5), r: 7 });
      }
      for (let k = 0; k <= 3; k++)
        for (let dx = -4; dx <= 4; dx++)
          for (let dz = -(3 - k); dz <= 3 - k; dz++) {
            const edge = Math.abs(dz) === 3 - k || Math.abs(dx) === 4;
            vol.set(bx + dx, hc + 4 + k, bz + dz, edge || k === 3 ? T.ROOF : T.WALL);
          }
      for (let y = hc + 4; y <= hc + 9; y++) vol.set(bx + 2, y, bz - 1, T.COBBLE);
      chimney = [bx + 2.5, hc + 10, bz - 0.5];
      vol.set(bx - 2, hc + 1, bz + 3, T.PUMPKIN);
      vol.set(bx + 3, hc + 1, bz + 3, T.PUMPKIN);
      vol.set(bx + 2, hc + 1, bz + 3, T.PUMPKIN);
      for (const [dx, dz] of [[-2, 3], [2, 3], [3, 3]]) top[col(bx + dx, bz + dz)] = hc + 1;
    }
  }

  // --- The wild: hash-seeded, never taller than the smallest specimen ------------------------
  const blobAt = (cx: number, cy: number, cz: number, r: number, ry: number, id: number): void => {
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++)
      for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++)
        for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
          const d = (dx * dx + dz * dz) / (r * r) + (dy * dy) / (ry * ry);
          if (d <= (1 - 0.3 * hash3(cx + dx, cy + dy, cz + dz)) ** 2) vol.fill(cx + dx, cy + dy, cz + dz, id);
        }
  };
  for (let z = -half; z <= half; z++)
    for (let x = -half; x <= half; x++) {
      const i = col(x, z);
      const h = top[i];
      if (h === EMPTY || wet[i] || vol.get(x, h, z) !== T.GRASS || vol.get(x, h + 1, z) !== 0) continue;
      const pd = pathDist[i], td = plotDist[i];
      const sc = streamCoords(x + 0.5, z + 0.5);
      const sd = sc.along >= 0 ? Math.abs(sc.across) : 99;
      const r = Math.hypot(x, z);
      const u = hash2(x * 3 + 1, z * 3 + 7);
      const pick = (block: number, salt: number) => {
        const bx = Math.floor(x / block), bz = Math.floor(z / block);
        const px = Math.floor(hash3(bx, salt, bz) * block), pz = Math.floor(hash3(bx, salt + 1, bz) * block);
        return x - bx * block === px && z - bz * block === pz ? hash3(bx, salt + 2, bz) : 1;
      };

      const treeRoll = pick(6, 40);
      if (treeRoll < 0.62 * decorDensity && pd > 7.6 && td > 8.2 && sd > 4.5 && r > 11) {
        if (hash2(x, z - 77) < 0.45) {
          const height = 4 + Math.floor(hash2(x + 3, z) * 3);
          vol.set(x, h + 1, z, T.WOOD);
          for (let k = 2; k <= height + 1; k++) {
            const rr = Math.max(0, (1 - (k - 2) / height) * 2.3);
            for (let dx = -2; dx <= 2; dx++)
              for (let dz = -2; dz <= 2; dz++) if (Math.hypot(dx, dz) <= rr) vol.fill(x + dx, h + k, z + dz, T.LEAF_B);
          }
          vol.fill(x, h + height + 2, z, T.LEAF_B);
        } else {
          const trunk = 2 + Math.floor(hash2(x - 3, z) * 2);
          for (let k = 1; k <= trunk; k++) vol.set(x, h + k, z, T.WOOD);
          blobAt(x, h + trunk + 2, z, 2 + hash2(x, z + 5) * 0.6, 1.8, T.LEAF_A);
        }
        continue;
      }
      const bushRoll = pick(4, 50);
      if (bushRoll < 0.3 * decorDensity && pd > 3.3 && td > 5.2 && sd > 3) {
        blobAt(x, h + 1, z, 1.3 + hash2(x + 9, z) * 0.8, 1.2, hash2(x, z + 21) < 0.7 ? T.LEAF_A : T.LEAF_B);
        continue;
      }
      const rockRoll = pick(5, 60);
      if (rockRoll < 0.2 && pd > 2.8 && td > 4.6) {
        const id = hash2(x, z - 5) < 0.5 ? T.STONE : T.COBBLE;
        vol.set(x, h + 1, z, id);
        if (rockRoll < 0.1) {
          vol.fill(x + 1, h + 1, z, id);
          vol.fill(x, h + 1, z + 1, id);
          vol.fill(x, h + 2, z, id);
        }
        continue;
      }
      if (pd < 2.4 || td < 4.2) continue;
      // Flowers come in drifts of one colour, the way they seed.
      const meadow = noise2(x * 0.11, z * 0.11, 33);
      if (meadow > 0.56 && u < 0.2) {
        vol.set(x, h + 1, z, T.FLOWER_R + Math.floor(noise2(x * 0.045, z * 0.045, 34) * 3.999));
      } else if (u > 0.5 && u < 0.56) {
        vol.set(x, h + 1, z, T.TUFT);
      } else if (u > 0.9 && u < 0.904 && pd > 6) {
        vol.set(x, h + 1, z, T.MUSHROOM);
      }
    }

  // Vines over the lip: the detail that says "this edge is a cliff, and things live on it".
  for (let z = -half + 1; z < half; z++)
    for (let x = -half + 1; x < half; x++) {
      if (top[col(x, z)] !== EMPTY) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const h = top[col(x + dx, z + dz)];
        if (h === EMPTY || wet[col(x + dx, z + dz)] || hash2(x * 5 + dx, z * 5 + dz) > 0.13) continue;
        const len = 1 + Math.floor(hash2(x - 3, z + 8) * 5);
        for (let k = 0; k < len; k++) vol.fill(x, h - k, z, T.VINE);
        break;
      }
    }

  // --- The fall: follow the stream out until the ground runs out -----------------------------
  let waterfall: Island["waterfall"] = null;
  {
    const dx = Math.cos(LAYOUT.STREAM_ANGLE), dz = Math.sin(LAYOUT.STREAM_ANGLE);
    let last: number | null = null;
    for (let along = 6; along < rMax + 4; along += 0.5) {
      const m = streamMeanderAt(along);
      const x = Math.floor(dx * along - dz * m), z = Math.floor(dz * along + dx * m);
      if (inGrid(x, z) && wet[col(x, z)]) last = along;
    }
    if (last !== null) {
      const m = streamMeanderAt(last);
      waterfall = { x: dx * last - dz * m, y: waterLevelAt(last), z: dz * last + dx * m, dx, dz };
    }
  }

  const lightAt = (x: number, y: number, z: number): number => {
    let sum = 0;
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      const ddx = x - l.x, ddz = z - l.z;
      if (ddx > l.r || ddx < -l.r || ddz > l.r || ddz < -l.r) continue;
      const d = Math.sqrt(ddx * ddx + (y - l.y) * (y - l.y) + ddz * ddz);
      if (d < l.r) sum += (1 - d / l.r) ** 2;
    }
    return Math.min(sum, 1.4);
  };

  return {
    volume: vol,
    radius: rMax,
    summit: domeH + 1,
    bottom: bottomMost,
    treeBase,
    lights,
    waterfall,
    chimney,
    lightAt,
    surfaceAt: (x, z) => {
      const xi = Math.floor(x), zi = Math.floor(z);
      if (!inGrid(xi, zi) || top[col(xi, zi)] === EMPTY) return null;
      return top[col(xi, zi)] + 1;
    },
  };
}

/** A small satellite rock: turf on top, stone beneath, something growing or glowing on it. */
export function buildIslet(seed: number, radius: number): Volume {
  const half = Math.ceil(radius) + 2;
  const depth = Math.ceil(radius * 1.7) + 4;
  const vol = new Volume(half * 2 + 1, depth + 14, half * 2 + 1, -half, -depth, -half);
  for (let z = -half; z <= half; z++)
    for (let x = -half; x <= half; x++) {
      const r = Math.hypot(x + 0.5, z + 0.5);
      const e = radius + (noise2(x * 0.4 + seed, z * 0.4, seed) - 0.5) * 2.5;
      if (r > e) continue;
      const t = r / e;
      const h = Math.round(1.2 * (1 - t * t));
      const b = h - Math.round(2 + radius * 1.5 * Math.pow(1 - t * t, 0.7) * (0.6 + 0.8 * noise2(x * 0.3, z * 0.3, seed + 3)));
      for (let y = b; y <= h; y++) vol.set(x, y, z, y === h ? T.GRASS : h - y <= 2 ? T.DIRT : hash3(x, y, z + seed) < 0.25 ? T.STONE_DARK : T.STONE);
      if (hash3(x, seed, z) < 0.03) for (let k = 1; k <= 3; k++) vol.set(x, b - k, z, T.CRYSTAL);
      if (hash3(x, seed + 9, z) < 0.07 && r > 1.5) vol.set(x, h + 1, z, T.FLOWER_R + Math.floor(hash3(x, seed + 4, z) * 3.999));
    }
  // One small tree, off-centre.
  const tx = Math.round((hash2(seed, 1) - 0.5) * radius * 0.6), tz = Math.round((hash2(seed, 2) - 0.5) * radius * 0.6);
  if (hash2(seed, 5) < 0.5) {
    for (let k = 2; k <= 3; k++) vol.set(tx, k, tz, T.WOOD);
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -1; dy <= 2; dy++)
        for (let dz = -2; dz <= 2; dz++)
          if (dx * dx + dy * dy * 1.4 + dz * dz <= 4.6 - hash3(dx + seed, dy, dz)) vol.fill(tx + dx, 5 + dy, tz + dz, T.LEAF_A);
  } else {
    vol.set(tx, 2, tz, T.WOOD);
    for (let k = 0; k < 5; k++)
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) if (Math.hypot(dx, dz) <= (1 - k / 5) * 2.3) vol.fill(tx + dx, 3 + k, tz + dz, T.LEAF_B);
  }
  return vol;
}

/** A cloud: a handful of overlapping slabs. */
export function buildCloud(seed: number): Volume {
  const vol = new Volume(34, 9, 20, -17, -3, -10);
  const lumps = 4 + Math.floor(hash2(seed, 3) * 4);
  for (let i = 0; i < lumps; i++) {
    const cx = Math.round((hash3(seed, i, 1) - 0.5) * 20), cz = Math.round((hash3(seed, i, 2) - 0.5) * 8);
    const rx = 4 + Math.floor(hash3(seed, i, 3) * 6), rz = 3 + Math.floor(hash3(seed, i, 4) * 4);
    const ry = 1 + Math.floor(hash3(seed, i, 5) * 2.4);
    for (let x = cx - rx; x <= cx + rx; x++)
      for (let z = cz - rz; z <= cz + rz; z++)
        for (let y = -1; y <= ry; y++) {
          // Slabs with their corners knocked off: square enough to be voxel, soft enough to be cloud.
          const corner = Math.abs(x - cx) === rx && Math.abs(z - cz) === rz;
          const upper = y === ry && (Math.abs(x - cx) > rx - 2 || Math.abs(z - cz) > rz - 2);
          if (!corner && !upper) vol.set(x, y, z, 1);
        }
  }
  return vol;
}
