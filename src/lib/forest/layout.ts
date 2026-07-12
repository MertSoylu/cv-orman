import { LAYOUT } from "@/lib/config";
import type { TreeData } from "@/lib/forest/treeData";

function fnv1aHash(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic exhibit-gallery layout: trees line a straight central path
 * (plane x=0), alternating left/right in pairs as they walk back along the
 * y-axis -- like paired plaques down a museum avenue, not a scattered forest.
 * Sideways offset grows with growthScore so bigger repos stand further from
 * the path, and a seeded jitter on top keeps rows from looking robotic.
 *
 * Trees are placed in sorted-id order so the same repo set always produces
 * the same layout; the whole path is centered on the origin so the renderer
 * can place camera/ground bounds around (0,0) without a fixed plane size.
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

  const seed = fnv1aHash(sorted.map((t) => t.id).join(","));
  const rng = mulberry32(seed);

  sorted.forEach((tree, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    const lateralJitter = (rng() - 0.5) * 2 * LAYOUT.PATH_LATERAL_JITTER;
    const lateral =
      side * (LAYOUT.PATH_LATERAL_BASE + tree.growthScore * LAYOUT.PATH_LATERAL_GROWTH) +
      lateralJitter;
    result.set(tree.id, { x: lateral, y: row * LAYOUT.PATH_SPACING });
  });

  const rowCount = Math.ceil(sorted.length / 2);
  const pathLength = Math.max(rowCount - 1, 0) * LAYOUT.PATH_SPACING;
  for (const [id, pos] of result) {
    result.set(id, { x: pos.x, y: pos.y - pathLength / 2 });
  }

  return result;
}
