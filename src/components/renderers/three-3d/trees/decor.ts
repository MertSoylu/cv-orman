"use client";

import type { Species } from "@/lib/forest/treeData";
import { seededRandom } from "../utils";
import { sampleTerrain } from "../terrain/heightfield";
import { VARIANTS_PER_SPECIES } from "./registry";

/**
 * Background trees that aren't repos.
 *
 * A personal repo list is a dozen or two entries. Rendered alone on an open
 * valley floor that reads as "some trees on a hill", not as a forest -- and the
 * exhibit's whole premise is a forest you walk into. So the stand is filled out
 * with unlabelled trees that carry no data and take no clicks.
 *
 * They cost nothing: they are appended to the *same* (species, variant)
 * instancing buckets the repo trees use, so a hundred of them add a hundred
 * instances and zero draw calls. They only ever use species already present in
 * the repo set, so the filler reads as the same wood rather than as a different
 * forest pasted behind the exhibit.
 *
 * The whole difficulty is that last property. Filler drawn from the same
 * species at the same size and the same colour *is* the exhibit, visually --
 * and the exhibit's entire job is to point at twenty specific trees. So the
 * filler is held back on all three axes it could compete on: it stands well
 * outside the repo trees' own band, it is capped below their smallest, and it
 * keeps clear of a cleared radius around each one. It fills the wood behind the
 * exhibit; it never joins it.
 */

export interface DecorTree {
  id: string;
  species: Species;
  variantIndex: number;
  position: [number, number, number];
  scale: number;
  yaw: number;
}

export interface DecorBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * Nearest a filler tree may stand to the trail. The repo trees sit at 5.0 or
 * 6.8 world units off the centerline (`LAYOUT.PATH_LATERAL_*` in plane units),
 * so this leaves a clear band of open ground behind them: from the trail, the
 * exhibit's trees are the only ones standing alone.
 *
 * The band is deliberately only a canopy or so wide. Pushed further out it
 * stops reading as a clearing behind the specimens and starts reading as a bald
 * lawn with a wood somewhere beyond it -- an avenue needs the wood standing
 * close behind it, or the specimens have nothing to be silhouetted against.
 */
const MIN_TRAIL_DISTANCE = 10;
const MAX_TRAIL_DISTANCE = 74;

/** A cleared circle around one repo tree that filler may not enter. */
export interface Clearing {
  x: number;
  z: number;
  radius: number;
}

export function buildDecorTrees(
  count: number,
  bounds: DecorBounds,
  speciesPool: Species[],
  seed: string,
  clearings: Clearing[] = [],
): DecorTree[] {
  if (count <= 0 || speciesPool.length === 0) return [];

  const rand = seededRandom(`decor-${seed}`);
  const trees: DecorTree[] = [];
  const attempts = count * 5;

  for (let i = 0; i < attempts && trees.length < count; i++) {
    const x = bounds.minX + (bounds.maxX - bounds.minX) * rand();
    const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * rand();
    const sample = sampleTerrain(x, z);

    if (sample.pathDistance < MIN_TRAIL_DISTANCE) continue;
    if (sample.pathDistance > MAX_TRAIL_DISTANCE) continue;
    if (sample.streamDistance < sample.streamHalfWidth * 1.6) continue;
    if (sample.slope > 0.55) continue;
    // Follow the terrain's own richness so the stand thickens in the hollows
    // and thins on the exposed ground, instead of being evenly sprinkled.
    if (rand() > 0.3 + sample.variation * 0.7) continue;
    // Keep out of the exhibit's own trees. Trail distance alone does not do
    // this: the trail winds, so a point 15 units from the centerline can still
    // land directly behind a repo tree a bend away, and a filler tree growing
    // out of a repo tree's canopy is exactly what makes the exhibit unreadable.
    if (isInsideClearing(x, z, clearings)) continue;

    const species = speciesPool[Math.floor(rand() * speciesPool.length)];
    trees.push({
      id: `decor-${trees.length}`,
      species,
      variantIndex: Math.floor(rand() * VARIANTS_PER_SPECIES),
      position: [x, sample.height - 0.06, z],
      // Capped below the smallest repo tree (`growthToScale`'s SCALE_MIN, times
      // the jitter floor). The exhibit's own trees have to stay the largest
      // thing anywhere near the trail, so this is a ceiling, not a suggestion.
      scale: 0.42 + rand() * 0.26,
      yaw: rand() * Math.PI * 2,
    });
  }

  return trees;
}

function isInsideClearing(x: number, z: number, clearings: Clearing[]): boolean {
  for (const clearing of clearings) {
    const dx = x - clearing.x;
    const dz = z - clearing.z;
    if (dx * dx + dz * dz < clearing.radius * clearing.radius) return true;
  }
  return false;
}
