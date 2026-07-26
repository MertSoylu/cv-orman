import { LAYOUT } from "@/lib/config";
import { computePathSpan, pathOffsetPoint } from "@/lib/forest/path";
import type { TreeData } from "@/lib/forest/treeData";

/**
 * Deterministic placement along the winding exhibit trail defined in
 * `lib/forest/path.ts`: trees walk the centerline two per **station**, one to
 * each side, offset sideways along the curve's own normal so the two files bend
 * with the trail instead of staying parallel to a fixed axis.
 *
 * The placement carries **no positional noise at all**, and that is the point.
 * An earlier version jittered both offsets so pairs would not "line up like
 * fence posts" -- which is the right instinct for a wild wood and the wrong one
 * for an exhibit. A botanical garden plants its specimen avenue on a grid, and
 * the regularity is what tells a visitor the planting was *chosen*. Here the
 * two trees of a station stand exactly opposite each other at exactly the same
 * setback, so walking the trail gives a steady left-right cadence; all the
 * variation the eye needs comes from species, canopy shape and size, which
 * differ far more than any jitter could.
 *
 * The one concession to the trees themselves is the bay: a large specimen is
 * stepped one discrete bay further back so its canopy clears the walk. A
 * discrete step keeps the files reading as lines; the continuous
 * growthScore-scaled offset it replaced did not.
 *
 * Placement is in sorted-id order and the span is centered on the origin, so
 * the same repo set always produces the same forest and the renderer can size
 * its ground/camera from the actual spread without a fixed plane size.
 */
export function computeForestLayout(
  trees: TreeData[],
): Map<string, { x: number; y: number }> {
  const sorted = [...trees].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const result = new Map<string, { x: number; y: number }>();
  if (sorted.length === 0) {
    return result;
  }

  const span = computePathSpan(sorted.length);

  sorted.forEach((tree, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const station = Math.floor(index / 2);

    const s = span.start + station * LAYOUT.PATH_SPACING;
    const bay = tree.growthScore >= LAYOUT.PATH_BAY_THRESHOLD ? LAYOUT.PATH_LATERAL_BAY : 0;

    result.set(tree.id, pathOffsetPoint(s, side * (LAYOUT.PATH_LATERAL_BASE + bay)));
  });

  return result;
}
