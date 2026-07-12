function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

// Read lazily (called from request handling), not at module evaluation time.
// `next build` imports route modules to collect their segment config without
// ever calling GET(), so eager top-level `requireEnv()` calls would fail the
// build itself whenever secrets aren't present in the build environment.
export function getGithubUsername(): string {
  return requireEnv("GITHUB_USERNAME");
}

export function getGithubToken(): string {
  return requireEnv("GITHUB_TOKEN");
}

/** Seconds. How often the GitHub data cache revalidates. */
export const REVALIDATE_SECONDS = 3600 as const;

export const GROWTH = {
  STARS_SOFT_CAP: 500,
  COMMITS_SOFT_CAP: 1000,
  STARS_WEIGHT: 0.45,
  COMMITS_WEIGHT: 0.45,
  AGE_WEIGHT: 0.1,
  AGE_SOFT_CAP_YEARS: 4,
  MIN_GROWTH_FLOOR: 0.15,
} as const;

export const HEALTH = {
  /** Days since last push within which a tree is fully healthy. */
  HEALTHY_DAYS: 30,
  /** Days since last push at which a tree reaches the wilted floor. */
  WILTED_AT_DAYS: 90,
  /** Health value a tree plateaus at once stale — never reaches 0. */
  WILTED_FLOOR: 0.15,
  /** healthStage at/above this counts as "healthy" for display (stats chip, legend). Single source of truth -- don't hardcode 0.7 at call sites. */
  HEALTHY_STAGE_THRESHOLD: 0.7,
} as const;

export const LAYOUT = {
  /** Distance between rows along the exhibit path (plane y-axis). */
  PATH_SPACING: 175,
  /** Base sideways distance from path center (plane x=0) to a tree's row. */
  PATH_LATERAL_BASE: 72,
  /** Extra sideways distance, scaled by growthScore -- bigger trees stand further out. */
  PATH_LATERAL_GROWTH: 40,
  /** +/- random jitter on top of the base+growth offset, keeps the row from looking robotic. */
  PATH_LATERAL_JITTER: 18,
} as const;
