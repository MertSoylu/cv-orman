import { HEALTH } from "@/lib/config";

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

/**
 * Piecewise health curve keyed off days since last push:
 *  - 0..HEALTHY_DAYS: fully healthy (1.0)
 *  - HEALTHY_DAYS..WILTED_AT_DAYS: linear fade to the wilted floor
 *  - beyond WILTED_AT_DAYS: plateaus at WILTED_FLOOR, never reaches 0
 * A floor (not an asymptote toward zero) is what guarantees a tree never
 * goes fully bare/dead — every renderer's color ramp has a non-zero bottom.
 */
export function computeHealthStage(lastPushedAt: string): number {
  const pushedMs = new Date(lastPushedAt).getTime();
  if (!Number.isFinite(pushedMs)) return HEALTH.WILTED_FLOOR;

  const days = (Date.now() - pushedMs) / (24 * 60 * 60 * 1000);
  if (!Number.isFinite(days)) return HEALTH.WILTED_FLOOR;

  if (days <= HEALTH.HEALTHY_DAYS) {
    return 1;
  }

  if (days <= HEALTH.WILTED_AT_DAYS) {
    const t =
      (days - HEALTH.HEALTHY_DAYS) /
      (HEALTH.WILTED_AT_DAYS - HEALTH.HEALTHY_DAYS);
    return lerp(1, HEALTH.WILTED_FLOOR, t);
  }

  return HEALTH.WILTED_FLOOR;
}
