"use client";

import type { Species } from "@/lib/forest/treeData";
import { seededRandom } from "./utils";
import { buildOak } from "./species/oak";
import { buildPine } from "./species/pine";
import { buildSakura } from "./species/sakura";
import { buildPalm } from "./species/palm";
import { buildBirch } from "./species/birch";
import { buildGeneric } from "./species/generic";
import type { SpeciesBuild } from "./species/types";

// One builder call per (species, variant) pair, not per tree -- geometry is
// pure/static for a given variant so it's built once and reused across
// however many trees land in that variant bucket. Bounded at
// SPECIES_COUNT * VARIANTS_PER_SPECIES builds total, however many trees (8 or
// 100+) end up sharing them. Shared by Tree3D (foliage/litter) and
// TrunkInstanceGroup (trunk/branch parts, instanced across every tree in a
// bucket) so both draw from the exact same cached geometry.
const SPECIES_BUILDERS: Record<Species, (rand: () => number) => SpeciesBuild> = {
  oak: buildOak,
  pine: buildPine,
  sakura: buildSakura,
  palm: buildPalm,
  birch: buildBirch,
  generic: buildGeneric,
};

/** Distinct geometric variants per species, so trees of the same species don't all share one identical curved-trunk/branch layout. */
export const VARIANTS_PER_SPECIES = 5;

const speciesCache = new Map<string, SpeciesBuild>();
export function getSpeciesBuild(species: Species, variantIndex: number): SpeciesBuild {
  const key = `${species}:${variantIndex}`;
  const cached = speciesCache.get(key);
  if (cached) return cached;
  // Seeded from the (species, variant) pair itself -- not the tree id -- so
  // every tree that maps into this bucket gets the exact same cached
  // geometry instead of triggering a rebuild.
  const rand = seededRandom(key);
  const build = SPECIES_BUILDERS[species](rand);
  speciesCache.set(key, build);
  return build;
}

/** Which cached (species, variant) geometry a tree uses -- a pure function of tree.id, so the same tree always lands on the same variant, but the variant pool itself stays small and pre-built. */
export function getVariantIndex(treeId: string): number {
  const rand = seededRandom(`${treeId}:variant`);
  return Math.floor(rand() * VARIANTS_PER_SPECIES);
}

export interface TreeJitter {
  rotationY: number;
  scaleVariance: number;
}

/** Deterministic per-tree jitter seeded from id: subtle rotation + scale variance so a forest of same-variant trees doesn't look copy-pasted, while staying stable across re-renders. */
export function getTreeJitter(treeId: string): TreeJitter {
  const rand = seededRandom(treeId);
  return {
    rotationY: rand() * Math.PI * 2,
    scaleVariance: 0.9 + rand() * 0.2, // +/-10%
  };
}

export interface TreeSway {
  phase: number;
  speed: number;
  amplitude: number;
}

/** Ambient wind: the whole crown-and-trunk assembly leans a few milliradians on a seeded phase/speed so neighboring trees never sway in lockstep. */
export function getTreeSway(treeId: string): TreeSway {
  const rand = seededRandom(`${treeId}:sway`);
  return {
    phase: rand() * Math.PI * 2,
    speed: 0.45 + rand() * 0.35,
    amplitude: 0.008 + rand() * 0.007,
  };
}
