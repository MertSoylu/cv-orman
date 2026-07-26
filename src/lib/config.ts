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
  /**
   * Distance between stations, measured along the path's forward axis.
   *
   * A "station" is one point on the walk with a specimen on each side. Both
   * trees of a station stand at exactly this `s` -- see `forest/layout.ts` for
   * why the placement carries no positional noise at all.
   */
  PATH_SPACING: 190,
  /** Sideways distance from the centerline to a specimen standing in the near bay. */
  PATH_LATERAL_BASE: 100,
  /**
   * Extra setback for a specimen in the far bay. Large trees are stepped one
   * bay back so their canopies clear the walk -- a discrete step rather than a
   * continuous function of growthScore, so the two files still read as lines.
   */
  PATH_LATERAL_BAY: 36,
  /** growthScore at/above which a specimen is planted in the far bay. */
  PATH_BAY_THRESHOLD: 0.5,
  /**
   * Serpentine centerline shape, in plane units. The path is x = f(s) where s
   * is forward distance: two out-of-phase sine waves, so it reads as a natural
   * winding trail rather than one regular S. Amplitudes stay well under
   * PATH_LATERAL_BASE * 2 so the two tree files never cross the centerline.
   *
   * What actually sets these numbers is the **maximum slope**, `A * 2pi / L`
   * summed over both waves -- the angle the walk can swing away from the
   * forward axis. The earlier values reached 0.82, or 39 degrees, and that is a
   * switchback rather than a walk: standing anywhere on it you could see one
   * station ahead before the trail left the frame entirely, so the avenue never
   * read as an avenue and the gate at the trail head sat off at the edge of the
   * frustum. These stay under 0.4 (about 22 degrees), which keeps three or four
   * stations in view down the aisle while still giving the top-down a lazy S.
   */
  CURVE_PRIMARY_AMPLITUDE: 115,
  CURVE_PRIMARY_WAVELENGTH: 1900,
  CURVE_SECONDARY_AMPLITUDE: 24,
  CURVE_SECONDARY_WAVELENGTH: 690,
  /** Phase offset of the secondary wave, so the two never peak together. */
  CURVE_SECONDARY_PHASE: 1.7,
} as const;
