import { LAYOUT } from "@/lib/config";

/**
 * The exhibit's winding centerline, shared by the data layer and the renderer.
 *
 * `lib/forest/layout.ts` walks this curve to place trees; the renderer walks
 * the same curve to lay the path ribbon, flatten the terrain corridor, and
 * rail the camera. Both must agree exactly, so the curve lives here as pure
 * math (no three.js, runs on the server) rather than being reinvented twice.
 *
 * Parametrization is by forward distance `s` along the plane's y-axis, with
 * the lateral offset an analytic function of it -- so tangent/normal are
 * closed-form, and "nearest point on the path" is a cheap 1-D search rather
 * than a spline projection.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Lateral offset of the centerline at forward distance `s`, in plane units. */
export function pathOffsetAt(s: number): number {
  return (
    Math.sin((s / LAYOUT.CURVE_PRIMARY_WAVELENGTH) * Math.PI * 2) * LAYOUT.CURVE_PRIMARY_AMPLITUDE +
    Math.sin((s / LAYOUT.CURVE_SECONDARY_WAVELENGTH) * Math.PI * 2 + LAYOUT.CURVE_SECONDARY_PHASE) *
      LAYOUT.CURVE_SECONDARY_AMPLITUDE
  );
}

/** d(offset)/ds -- analytic derivative of `pathOffsetAt`. */
export function pathSlopeAt(s: number): number {
  const k1 = (Math.PI * 2) / LAYOUT.CURVE_PRIMARY_WAVELENGTH;
  const k2 = (Math.PI * 2) / LAYOUT.CURVE_SECONDARY_WAVELENGTH;
  return (
    Math.cos(s * k1) * LAYOUT.CURVE_PRIMARY_AMPLITUDE * k1 +
    Math.cos(s * k2 + LAYOUT.CURVE_SECONDARY_PHASE) * LAYOUT.CURVE_SECONDARY_AMPLITUDE * k2
  );
}

/** Centerline point at forward distance `s`. */
export function pathPointAt(s: number): Vec2 {
  return { x: pathOffsetAt(s), y: s };
}

/** Unit tangent (direction of travel) at `s`. */
export function pathTangentAt(s: number): Vec2 {
  const dx = pathSlopeAt(s);
  const len = Math.hypot(dx, 1);
  return { x: dx / len, y: 1 / len };
}

/** Unit normal at `s`, pointing to the left of the direction of travel. */
export function pathNormalAt(s: number): Vec2 {
  const t = pathTangentAt(s);
  return { x: -t.y, y: t.x };
}

/** Point offset `lateral` plane units sideways from the centerline at `s`. */
export function pathOffsetPoint(s: number, lateral: number): Vec2 {
  const center = pathPointAt(s);
  const normal = pathNormalAt(s);
  return { x: center.x + normal.x * lateral, y: center.y + normal.y * lateral };
}

export interface PathSpan {
  /** Forward distance of the first tree row. Negative -- the span is centered on s = 0. */
  start: number;
  /** Forward distance of the last tree row. */
  end: number;
}

/**
 * Forward extent the exhibit occupies for a given tree count, centered on
 * s = 0. Trees are placed two per row, so the span grows one PATH_SPACING per
 * pair. A single tree still gets a short span so the path never degenerates
 * to a point.
 */
export function computePathSpan(treeCount: number): PathSpan {
  const rowCount = Math.max(Math.ceil(treeCount / 2), 1);
  const length = Math.max(rowCount - 1, 1) * LAYOUT.PATH_SPACING;
  return { start: -length / 2, end: length / 2 };
}

/**
 * Nearest point on the centerline to an arbitrary plane point, returned as
 * `{ s, distance, side }` where `side` is +1 left of travel, -1 right.
 *
 * Coarse scan then refine: the curve is y-monotonic, so `s` is always close
 * to `y` -- searching a window around it converges far faster than projecting
 * onto a sampled polyline, and never needs the polyline built at all.
 */
export function nearestOnPath(
  x: number,
  y: number,
  windowHalfWidth = 260,
): { s: number; distance: number; side: number } {
  let bestS = y;
  let bestSq = Infinity;

  const coarseSteps = 14;
  for (let i = 0; i <= coarseSteps; i++) {
    const s = y - windowHalfWidth + (2 * windowHalfWidth * i) / coarseSteps;
    const dx = x - pathOffsetAt(s);
    const dy = y - s;
    const sq = dx * dx + dy * dy;
    if (sq < bestSq) {
      bestSq = sq;
      bestS = s;
    }
  }

  let step = (2 * windowHalfWidth) / coarseSteps;
  for (let pass = 0; pass < 4; pass++) {
    step *= 0.5;
    for (const s of [bestS - step, bestS + step]) {
      const dx = x - pathOffsetAt(s);
      const dy = y - s;
      const sq = dx * dx + dy * dy;
      if (sq < bestSq) {
        bestSq = sq;
        bestS = s;
      }
    }
  }

  const normal = pathNormalAt(bestS);
  const toPointX = x - pathOffsetAt(bestS);
  const toPointY = y - bestS;
  const side = toPointX * normal.x + toPointY * normal.y >= 0 ? 1 : -1;

  return { s: bestS, distance: Math.sqrt(bestSq), side };
}
