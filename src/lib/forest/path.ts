import { LAYOUT } from "@/lib/config";

/**
 * The exhibit walk: an Archimedean spiral, as pure math with no three.js.
 *
 * `lib/forest/layout.ts` walks it to plant trees; the voxel renderer walks the
 * same curve to pave the path, hang lanterns and carve the stream that crosses
 * it. There is exactly one definition so the two can never disagree.
 *
 * The spiral is parametrized by angle `theta` (radius grows `SPIRAL_LOOP_GAP`
 * per turn). Coordinates are plane coordinates `{x, y}`; the renderer maps
 * `y` onto world Z.
 */

export interface Vec2 {
  x: number;
  y: number;
}

const GROWTH_PER_RADIAN = LAYOUT.SPIRAL_LOOP_GAP / (Math.PI * 2);

export function spiralRadiusAt(theta: number): number {
  return LAYOUT.SPIRAL_START_RADIUS + GROWTH_PER_RADIAN * theta;
}

export function spiralPointAt(theta: number): Vec2 {
  const r = spiralRadiusAt(theta);
  return { x: Math.cos(theta) * r, y: Math.sin(theta) * r };
}

/** Unit tangent, pointing outward along the walk (toward the gate). */
export function spiralTangentAt(theta: number): Vec2 {
  const r = spiralRadiusAt(theta);
  const dx = GROWTH_PER_RADIAN * Math.cos(theta) - r * Math.sin(theta);
  const dy = GROWTH_PER_RADIAN * Math.sin(theta) + r * Math.cos(theta);
  const len = Math.hypot(dx, dy);
  return { x: dx / len, y: dy / len };
}

/** Unit normal pointing away from the island's center. */
export function spiralNormalAt(theta: number): Vec2 {
  const t = spiralTangentAt(theta);
  return { x: t.y, y: -t.x };
}

/** Advance `theta` by arc length `ds` (numerically; the spiral has no closed-form inverse). */
export function spiralAdvance(theta: number, ds: number): number {
  const steps = Math.max(1, Math.ceil(Math.abs(ds) / 0.5));
  const h = ds / steps;
  let t = theta;
  for (let i = 0; i < steps; i++) {
    t += h / Math.hypot(spiralRadiusAt(t), GROWTH_PER_RADIAN);
  }
  return t;
}

/** Sideways meander of the stream at distance `along` from the island center. */
export function streamMeanderAt(along: number): number {
  const ease = Math.min(1, Math.max(0, (along - 8) / 10));
  return Math.sin(along * 0.21) * 1.7 * ease;
}

/**
 * Stream-relative coordinates of a plane point: `along` is distance from the
 * island center down the stream's axis, `across` the signed distance from the
 * (meandering) centerline. Behind the summit `across` is the plain distance
 * from the center, so the stream has a rounded head rather than a line through
 * the whole island.
 */
export function streamCoords(x: number, y: number): { along: number; across: number } {
  const dx = Math.cos(LAYOUT.STREAM_ANGLE);
  const dy = Math.sin(LAYOUT.STREAM_ANGLE);
  const along = x * dx + y * dy;
  if (along < 0) return { along, across: Math.hypot(x, y) };
  return { along, across: -x * dy + y * dx - streamMeanderAt(along) };
}

export interface Station {
  theta: number;
  point: Vec2;
  normal: Vec2;
}

export interface SpiralPlan {
  stations: Station[];
  /** Where the walk ends and the gate stands. */
  thetaEnd: number;
}

/**
 * Stations for `treeCount` trees (two per station), stepping over the stream:
 * a station whose centerline point is within STREAM_CLEARANCE of the water is
 * pushed along the walk until it is clear, because its two trees stand on the
 * radial through it -- which is the direction the stream runs.
 */
export function planSpiral(treeCount: number): SpiralPlan {
  const stationCount = Math.max(1, Math.ceil(treeCount / 2));
  const stations: Station[] = [];
  let theta = 0.35;
  for (let i = 0; i < stationCount; i++) {
    for (let guard = 0; guard < 200; guard++) {
      const p = spiralPointAt(theta);
      const sc = streamCoords(p.x, p.y);
      if (sc.along < 0 || Math.abs(sc.across) >= LAYOUT.STREAM_CLEARANCE) break;
      theta = spiralAdvance(theta, 1);
    }
    stations.push({ theta, point: spiralPointAt(theta), normal: spiralNormalAt(theta) });
    theta = spiralAdvance(theta, LAYOUT.STATION_SPACING);
  }
  const last = stations[stations.length - 1].theta;
  return { stations, thetaEnd: spiralAdvance(last, LAYOUT.HEAD_LENGTH) };
}
