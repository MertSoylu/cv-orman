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

/**
 * The exhibit is a spiral walk on a floating voxel island. Every length here is
 * in **voxels** (one voxel = one world unit) and every tree lands on an integer
 * cell -- a voxel world has exactly one grid, and anything placed off it reads
 * as a rendering bug.
 */
export const LAYOUT = {
  /** Radius the spiral walk starts at. Leaves room for the summit pond inside it. */
  SPIRAL_START_RADIUS: 17,
  /** Radial distance between one loop of the walk and the next. */
  SPIRAL_LOOP_GAP: 28,
  /** Arc length between stations. A station is a point on the walk with a tree on each side. */
  STATION_SPACING: 14,
  /** Sideways distance from the walk's centerline to a tree. */
  TREE_SETBACK: 7,
  /** Walk that continues past the last station, out to the gate. */
  HEAD_LENGTH: 12,
  /** Direction (radians) the stream leaves the summit pond in. */
  STREAM_ANGLE: 1.05,
  /** Stations closer than this to the stream are skipped, so no tree is planted in the water. */
  STREAM_CLEARANCE: 7.5,
} as const;
