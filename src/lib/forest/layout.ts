import { LAYOUT } from "@/lib/config";
import { planSpiral } from "@/lib/forest/path";
import type { TreeData } from "@/lib/forest/treeData";

/**
 * Deterministic placement along the spiral walk in `lib/forest/path.ts`: two
 * trees per station, one on the inside of the curve and one on the outside.
 *
 * Trees are planted **oldest first from the summit outward**, so the walk is a
 * timeline -- you enter at the gate among the newest repos and climb back
 * through the years to the first one, the way a trunk's rings read from bark
 * to pith. `createdAt` never changes, so neither does anyone's place.
 *
 * Positions are rounded to whole voxels. The renderer's world is one integer
 * grid, and a trunk straddling two cells cannot be drawn in it.
 */
export function computeForestLayout(
  trees: TreeData[],
): Map<string, { x: number; y: number }> {
  const result = new Map<string, { x: number; y: number }>();
  if (trees.length === 0) return result;

  const sorted = [...trees].sort((a, b) => {
    const ta = Date.parse(a.createdAt) || 0;
    const tb = Date.parse(b.createdAt) || 0;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const { stations } = planSpiral(sorted.length);
  sorted.forEach((tree, index) => {
    const station = stations[Math.floor(index / 2)];
    const side = index % 2 === 0 ? 1 : -1;
    result.set(tree.id, {
      x: Math.round(station.point.x + station.normal.x * side * LAYOUT.TREE_SETBACK),
      y: Math.round(station.point.y + station.normal.y * side * LAYOUT.TREE_SETBACK),
    });
  });
  return result;
}
