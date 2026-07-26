"use client";

import type { PlacedTreeData, Species } from "@/lib/forest/treeData";
import { growthToScale, seededRandom } from "../utils";
import { buildTree, type TreeBuild } from "./species/builder";
import { SPECIES_PRESETS } from "./species/presets";

/**
 * Species geometry cache and the seeded per-tree derivations.
 *
 * Builds are cached per `(species, variant, foliageDensity)` at module scope --
 * never per tree. Geometry is a pure function of those three, so a hundred oaks
 * sharing variant 0 share one build, and that is exactly what lets the whole
 * forest collapse into a handful of InstancedMesh draw calls.
 */

/**
 * Two variants per species. More would look richer in isolation, but each
 * (species, variant) pair is its own instancing bucket -- and therefore its own
 * set of draw calls -- so two is the point where added variety stops paying for
 * itself against a typical repo list.
 */
export const VARIANTS_PER_SPECIES = 2;

const buildCache = new Map<string, TreeBuild>();

export function getSpeciesBuild(
  species: Species,
  variantIndex: number,
  foliageDensity: number,
): TreeBuild {
  const key = `${species}:${variantIndex}:${foliageDensity.toFixed(2)}`;
  const cached = buildCache.get(key);
  if (cached) return cached;

  const build = buildTree(
    SPECIES_PRESETS[species],
    seededRandom(`${species}-variant-${variantIndex}`),
    foliageDensity,
  );
  buildCache.set(key, build);
  return build;
}

/** Which geometry variant a repo gets. Stable for a given repo id. */
export function getVariantIndex(id: string): number {
  return Math.floor(seededRandom(`${id}-variant`)() * VARIANTS_PER_SPECIES);
}

export interface TreeJitter {
  /** Yaw, so two trees sharing a variant never present the same profile. */
  yaw: number;
  /** Small multiplier on top of the growth-derived scale. */
  scaleVariance: number;
}

export function getTreeJitter(id: string): TreeJitter {
  const rand = seededRandom(`${id}-jitter`);
  return {
    yaw: rand() * Math.PI * 2,
    scaleVariance: 0.9 + rand() * 0.2,
  };
}

export interface TreeMetrics {
  /** Final world scale applied to the tree's local geometry. */
  scale: number;
  yaw: number;
  /** World-space height of the finished tree. */
  height: number;
  /** World-space canopy radius. */
  spread: number;
}

/**
 * The finished world dimensions of one tree. Shared by the instancer, the hit
 * proxy, the plaque placement and the hover halo, so all four agree on where a
 * tree actually is instead of each guessing from its own constants.
 */
export function getTreeMetrics(tree: PlacedTreeData, foliageDensity: number): TreeMetrics {
  const build = getSpeciesBuild(tree.species, getVariantIndex(tree.id), foliageDensity);
  const jitter = getTreeJitter(tree.id);
  const scale = growthToScale(tree.growthScore) * jitter.scaleVariance;
  return {
    scale,
    yaw: jitter.yaw,
    height: build.height * scale,
    spread: build.spread * scale,
  };
}
