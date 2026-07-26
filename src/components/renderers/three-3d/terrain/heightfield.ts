"use client";

import { pathOffsetAt } from "@/lib/forest/path";

/**
 * The ground, as a pure function.
 *
 * Everything that has to sit *on* the world -- the terrain mesh, every tree,
 * every fern and rock, the trail ribbon, the plaques, the camera's floor clamp
 * -- samples this same function instead of each carrying its own guess. That is
 * the only way a procedural landscape stays consistent: the moment two systems
 * disagree about where the ground is, props float and trees sink.
 *
 * It is deterministic and allocation-free, so it is safe to call tens of
 * thousands of times while building a mesh, and safe to call per frame.
 */

/** Plane units per world unit. `lib/forest/layout.ts` works in plane units; three.js works in world units. */
export const PLANE_SCALE = 20;

export function planeToWorld(x: number, y: number): [number, number] {
  return [x / PLANE_SCALE, y / PLANE_SCALE];
}

// --- shape constants -------------------------------------------------------

/** Within this distance of the trail the ground is essentially flat. */
const CORRIDOR_INNER = 2.5;
/** Past this distance the hills reach full height. */
const CORRIDOR_OUTER = 24;
const HILL_AMPLITUDE = 11;
const BUMP_AMPLITUDE = 0.85;

/** Nominal half-width of the stream channel, and how deep it cuts below the valley floor. */
export const STREAM_WIDTH = 4.6;
const STREAM_DEPTH = 2.2;
/**
 * Surface height of the water. Set below the channel lip so banks read as banks.
 *
 * With the parabolic bed below, this puts the waterline at a constant fraction
 * of the local half-width at every point along the stream -- see
 * `WATERLINE_FRACTION`.
 */
export const WATER_LEVEL = -1.05;

/**
 * Where the water's edge sits, as a fraction of the local half-width.
 *
 * `sqrt(1 - WATER_LEVEL / -STREAM_DEPTH)` for the parabolic bed below. This is
 * the number that lets the waterside planting, the terrain's wet margin and the
 * bridge's span all be expressed against the water rather than against the
 * channel -- the channel is nearly half again as wide as the water in it, and
 * measuring against the wrong one is how you end up with a ten-metre bridge
 * over a four-metre creek.
 */
export const WATERLINE_FRACTION = Math.sqrt(1 - 1.05 / 2.2);

// ---------------------------------------------------------------------------
// Noise
// ---------------------------------------------------------------------------

function hash(ix: number, iy: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const n00 = hash(x0, y0);
  const n10 = hash(x0 + 1, y0);
  const n01 = hash(x0, y0 + 1);
  const n11 = hash(x0 + 1, y0 + 1);

  const top = n00 + (n10 - n00) * sx;
  const bottom = n01 + (n11 - n01) * sx;
  return top + (bottom - top) * sy;
}

function fbm(x: number, y: number, octaves: number): number {
  let amplitude = 1;
  let frequency = 1;
  let total = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    total += valueNoise(x * frequency + o * 31.7, y * frequency - o * 17.3) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return total / norm;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// Distance to the trail
// ---------------------------------------------------------------------------

/**
 * `nearestOnPath` in `lib/forest/path.ts` is exact but costs ~20 sine
 * evaluations per query. Building a terrain mesh queries it once per vertex --
 * tens of thousands of times in one frame -- so the heightfield goes through a
 * precomputed table of centerline offsets instead and searches a window of it
 * with no trigonometry at all.
 *
 * The window is sized from the curve's steepest slope: the nearest centerline
 * point can never be further from `z` than the curve's own maximum lateral
 * excursion, so a fixed +/- window is safe rather than merely likely.
 */
const TABLE_STEP = 6;
const TABLE_HALF_RANGE = 7000;
const TABLE_WINDOW = 28;

let offsetTable: Float32Array | null = null;

function getOffsetTable(): Float32Array {
  if (offsetTable) return offsetTable;
  const count = Math.ceil((TABLE_HALF_RANGE * 2) / TABLE_STEP) + 1;
  const table = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    table[i] = pathOffsetAt(-TABLE_HALF_RANGE + i * TABLE_STEP);
  }
  offsetTable = table;
  return table;
}

/** World-space distance from a world XZ to the trail centerline. */
export function pathDistance(x: number, z: number): number {
  const table = getOffsetTable();
  const planeX = x * PLANE_SCALE;
  const planeZ = z * PLANE_SCALE;

  const center = Math.round((planeZ + TABLE_HALF_RANGE) / TABLE_STEP);
  const from = Math.max(center - TABLE_WINDOW, 0);
  const to = Math.min(center + TABLE_WINDOW, table.length - 1);

  let bestSq = Infinity;
  for (let i = from; i <= to; i++) {
    const s = -TABLE_HALF_RANGE + i * TABLE_STEP;
    const dx = planeX - table[i];
    const dz = planeZ - s;
    const sq = dx * dx + dz * dz;
    if (sq < bestSq) bestSq = sq;
  }

  return Math.sqrt(bestSq) / PLANE_SCALE;
}

// ---------------------------------------------------------------------------
// The stream
// ---------------------------------------------------------------------------

/**
 * The stream crosses the trail once, at the exhibit's midpoint, running
 * broadly perpendicular to it. That single crossing is the scene's one
 * landmark: it gives the walk a middle, and it is where the bridge goes.
 *
 * Its centerline is a straight run along world X with a slow lateral wander,
 * which is enough to read as a natural watercourse without needing a second
 * curve system.
 */
const STREAM_WANDER_AMPLITUDE = 4.2;
const STREAM_WANDER_WAVELENGTH = 46;

/**
 * World X of the trail/stream crossing. The trail centerline is x = f(s) and
 * the stream runs along X near z = 0, so they meet a little over 2 world units
 * off the axis. Both the narrows and the steering bend below are centred here,
 * so the channel is at its tightest and squarest exactly where the walk needs
 * to get across it.
 */
const NARROWS_X = 2.5;

/**
 * A local bend that swings the channel square to the trail at the crossing.
 *
 * Left to its own two sines the stream meets the trail at about 63 degrees, and
 * an oblique crossing is the single thing that makes a footbridge look wrong:
 * the deck has to be longer than the water is wide just to reach the far bank,
 * and it reads as lying along the stream rather than crossing it. So the
 * channel takes a bend here -- which is what a real watercourse does anyway,
 * and is why fords and bridges end up where they do.
 *
 * `STEER_SLOPE` is d(wander)/dx at the crossing, chosen so the channel's
 * tangent is perpendicular to the trail's. It is a constant rather than a live
 * evaluation of `pathSlopeAt` because the crossing's own position depends on
 * the wander, so solving it exactly would be a fixed point; the value is
 * verified numerically instead.
 */
const STEER_SLOPE = -0.47;
const STEER_FALLOFF = 15;

/** Signed distance from a world point to the stream centerline. */
export function streamDistance(x: number, z: number): number {
  const t = (x - NARROWS_X) / STEER_FALLOFF;
  const wander =
    Math.sin((x / STREAM_WANDER_WAVELENGTH) * Math.PI * 2) * STREAM_WANDER_AMPLITUDE +
    Math.sin((x / (STREAM_WANDER_WAVELENGTH * 0.37)) * Math.PI * 2 + 0.9) *
      STREAM_WANDER_AMPLITUDE *
      0.25 +
    STEER_SLOPE * (x - NARROWS_X) * Math.exp(-t * t);
  return z - wander;
}

/**
 * The channel is not a constant-width slot. A watercourse that never changes
 * width reads as a canal: it is the alternation of wide slack pools and tight
 * fast runs that makes moving water legible at a glance, and it is what gives
 * the bridge somewhere sensible to stand.
 *
 * Two slow sines supply the pools-and-runs rhythm; a gaussian pinch centred
 * where the trail meets the water forces a narrows there. Bridges get built at
 * the narrowest crossing available -- spanning the widest part of a stream is
 * the one thing nobody has ever done -- so the pinch is what makes the crossing
 * read as chosen rather than as an arbitrary cut through the ribbon.
 */
const WIDTH_VARIATION = 0.3;
const NARROWS_FALLOFF = 16;
const NARROWS_PINCH = 0.52;

/** Half-width of the water channel at a world X, in world units. */
export function streamHalfWidth(x: number): number {
  const rhythm =
    1 +
    Math.sin(x / 23.7) * WIDTH_VARIATION +
    Math.sin(x / 8.9 + 2.1) * WIDTH_VARIATION * 0.34;
  const t = (x - NARROWS_X) / NARROWS_FALLOFF;
  return STREAM_WIDTH * rhythm * (1 - NARROWS_PINCH * Math.exp(-t * t));
}

/**
 * How fast the water is moving at a world X, 0 (slack pool) to 1 (tight run).
 *
 * Continuity, not decoration: the same volume through a narrower channel has to
 * move faster. The water shader scrolls its ripples and raises foam off this,
 * so the surface speeds up exactly where the banks close in.
 */
export function streamFlow(x: number): number {
  const ratio = STREAM_WIDTH / streamHalfWidth(x);
  return Math.min(Math.max((ratio - 0.85) / 1.05, 0), 1);
}

// ---------------------------------------------------------------------------
// Height
// ---------------------------------------------------------------------------

export interface TerrainSample {
  height: number;
  /** World-space distance to the trail centerline. */
  pathDistance: number;
  /** Absolute world-space distance to the stream centerline. */
  streamDistance: number;
  /** Half-width of the channel at this point, so callers can test "in the water" against the real bank. */
  streamHalfWidth: number;
  /** 0 = flat, 1 = steep. Derived by finite difference. */
  slope: number;
  /** 0-1 low-frequency variation, used to break up ground tint and prop density. */
  variation: number;
}

/** Width of the gravel trail. Trees are placed well clear of it by `LAYOUT.PATH_LATERAL_BASE`. */
export const TRAIL_WIDTH = 4.4;

/** Height of the ground at a world XZ, before any prop or mesh offset. */
export function terrainHeight(x: number, z: number): number {
  return heightFromDistances(x, z, pathDistance(x, z));
}

function heightFromDistances(x: number, z: number, trailDistance: number): number {
  // Hills are masked out along the trail, so the exhibit walk stays level while
  // the land still rolls behind the trees.
  const openness = smoothstep(CORRIDOR_INNER, CORRIDOR_OUTER, trailDistance);
  const hills = fbm(x * 0.013, z * 0.013, 4) * 2 - 1;
  const bumps = fbm(x * 0.07, z * 0.07, 3) * 2 - 1;

  let height = hills * HILL_AMPLITUDE * openness + bumps * BUMP_AMPLITUDE * (0.14 + openness * 0.86);

  const toStream = Math.abs(streamDistance(x, z));

  // A watercourse cuts a floodplain, not just a slot. Flattening the land
  // either side of the channel first is what lets one fixed water level read as
  // a stream along its whole length -- carving a fixed-depth channel into
  // rolling hills instead buries the surface under the high ground and leaves
  // water visible only where the terrain happened to be low.
  //
  // The floodplain is deliberately keyed to the *nominal* width rather than the
  // local one: the channel narrows and widens, but the valley it sits in does
  // not, and letting the flat margin breathe with the water would ripple the
  // whole riverbank in step with the pinches.
  const floodplain = 1 - smoothstep(STREAM_WIDTH, STREAM_WIDTH * 5, toStream);
  height *= 1 - floodplain * 0.88;

  // Then carve the bed, at the local width.
  const halfWidth = streamHalfWidth(x);
  const q = Math.min(toStream / halfWidth, 1);

  // Inside the channel the remaining terrain noise is flattened almost to
  // nothing. It has to be: what is left of the hills after the floodplain is
  // still over a metre of relief, against about the same in water depth, so
  // leaving it in means the surface pools in some stretches and vanishes under
  // dry ground in others.
  height *= 1 - (1 - smoothstep(0.55, 1.15, q)) * 0.85;

  // A parabolic bed, faired off at the lip. The profile matters more than it
  // looks: with a fixed water level, the shape of the bed is the *only* thing
  // deciding where the waterline lands, and it lands at a constant fraction of
  // the half-width only if the profile is scale-free in q. That is what lets
  // the reeds, stones and lily pads be placed against `WATERLINE` as a single
  // constant instead of each solving for the surface themselves.
  const bed = (1 - q * q) * (1 - smoothstep(0.82, 1, q));
  height -= bed * STREAM_DEPTH;

  return height;
}

/** Height plus the classification data props and vertex coloring need. */
export function sampleTerrain(x: number, z: number): TerrainSample {
  const trailDistance = pathDistance(x, z);
  const height = heightFromDistances(x, z, trailDistance);

  // Slope is taken with the trail distance held fixed: re-querying it for the
  // two offset samples would triple the cost of building a terrain mesh, and
  // the corridor mask varies far too slowly to matter at this delta.
  const delta = 0.8;
  const dx = heightFromDistances(x + delta, z, trailDistance) - height;
  const dz = heightFromDistances(x, z + delta, trailDistance) - height;

  return {
    height,
    pathDistance: trailDistance,
    streamDistance: Math.abs(streamDistance(x, z)),
    streamHalfWidth: streamHalfWidth(x),
    slope: Math.min(Math.hypot(dx, dz) / delta, 1),
    variation: fbm(x * 0.028, z * 0.028, 2),
  };
}
