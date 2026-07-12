import { GROWTH } from "@/lib/config";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface GrowthInput {
  stars: number;
  commitCount: number;
  createdAt: string;
}

/**
 * Combines stars + commits (primary, log-compressed so outliers don't blow
 * out the scale) with repo age (small secondary modifier) into a single
 * 0-1 score. Floored above 0 so even a brand-new, 0-star repo renders as a
 * visible sapling rather than nothing.
 */
export function computeGrowthScore(repo: GrowthInput): number {
  const stars = Number.isFinite(repo.stars) ? repo.stars : 0;
  const commitCount = Number.isFinite(repo.commitCount)
    ? repo.commitCount
    : 0;
  const createdMs = new Date(repo.createdAt).getTime();
  if (!Number.isFinite(createdMs)) return GROWTH.MIN_GROWTH_FLOOR;

  const starsNorm = Math.log1p(stars) / Math.log1p(GROWTH.STARS_SOFT_CAP);
  const commitsNorm =
    Math.log1p(commitCount) / Math.log1p(GROWTH.COMMITS_SOFT_CAP);

  const primary =
    starsNorm * GROWTH.STARS_WEIGHT + commitsNorm * GROWTH.COMMITS_WEIGHT;

  const ageYears =
    (Date.now() - createdMs) / (365.25 * 24 * 60 * 60 * 1000);
  const ageNorm = clamp(ageYears / GROWTH.AGE_SOFT_CAP_YEARS, 0, 1);
  const ageBonus = ageNorm * GROWTH.AGE_WEIGHT;

  return clamp(primary + ageBonus, GROWTH.MIN_GROWTH_FLOOR, 1);
}
