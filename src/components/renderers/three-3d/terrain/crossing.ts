"use client";

import { pathPointAt, pathTangentAt } from "@/lib/forest/path";
import {
  PLANE_SCALE,
  streamDistance,
  streamHalfWidth,
  terrainHeight,
  TRAIL_WIDTH,
  WATERLINE_FRACTION,
} from "./heightfield";

/**
 * Where the trail meets the stream, and the shape of the bridge that spans it.
 *
 * Split out of `Trail.tsx` because the crossing is the one place three separate
 * things have to agree exactly: where the gravel stops, where the deck starts,
 * and how the deck cambers between them. Kept together, they are a handful of
 * constants and one parabola; kept apart, they are three near-copies that drift
 * the moment any of them is tuned.
 */

/** Plane units between ribbon cross-sections. Small enough that curvature stays smooth. */
export const TRAIL_SAMPLE_STEP = 9;
/** Ribbon sits this far above the ground, clear of z-fighting without floating. */
export const TRAIL_SURFACE_LIFT = 0.035;

/**
 * Half-width of the gravel at forward distance `s`, in world units.
 *
 * The width breathes very slightly along the walk so the edges read as trodden
 * rather than machine-cut. It lives here because the ribbon is no longer the
 * only thing that needs it: `Kerb.tsx` lays its stones against this same curve,
 * and a kerb built off a constant half-width crosses onto the gravel wherever
 * the ribbon happens to be at its widest.
 */
export function trailHalfWidth(s: number): number {
  return (TRAIL_WIDTH / 2) * (0.9 + Math.sin(s * 0.011) * 0.1);
}
/**
 * Half-width of the gap left for the bridge, as a multiple of the **waterline**
 * -- not of the channel half-width.
 *
 * The distinction is the whole difference between a footbridge and a viaduct.
 * The channel is about 1.4x wider than the water sitting in it, so measuring
 * the gap against the channel and then adding abutments produced a deck two and
 * a half times the width of the creek it crossed: it read as absurd because it
 * was. Against the waterline, the gravel stops a stride back from the water and
 * the deck is about as long as a person would actually build it.
 */
const GAP_FACTOR = 1.5;

export const DECK_THICKNESS = 0.1;
export const DECK_BASE = 0.2;
/** Rise of the deck at midspan. Small: a footbridge cambers, it does not vault. */
export const ARCH_RISE = 0.26;
export const RAIL_HEIGHT = 0.92;
/** How far each end of the deck runs past the gravel's edge, onto the bank. */
export const ABUTMENT_OVERLAP = 0.7;
/**
 * Deck width against the trail's. Deliberately narrower than the path: a plank
 * bridge is the width of the timber someone could carry, and a deck as wide as
 * the trail reads as a road bridge -- and at this span, nearly square in plan.
 */
const DECK_WIDTH_FACTOR = 0.62;

export interface Crossing {
  position: [number, number, number];
  yaw: number;
  /** Distance between the two gravel ends, in world units. */
  span: number;
}

/** True where the gravel ribbon stops and the bridge takes over. */
export function inBridgeGap(worldX: number, worldZ: number): boolean {
  const waterline = streamHalfWidth(worldX) * WATERLINE_FRACTION;
  return Math.abs(streamDistance(worldX, worldZ)) < waterline * GAP_FACTOR;
}

/**
 * Local deck height and pitch at `t` in [-1, 1] along the span.
 *
 * One parabola drives the planks, the stringers under them, the rails above and
 * the posts between -- so the whole structure cambers as one object. Anything
 * that placed the rail off a separate curve would show as it drifting off its
 * own deck at midspan.
 */
export function archAt(t: number): { y: number; pitch: number } {
  return { y: ARCH_RISE * (1 - t * t), pitch: Math.atan2(2 * ARCH_RISE * t, 1) };
}

/**
 * Walk the trail looking for the one place it crosses the water.
 *
 * The deck sits level with the two bank lips, *not* with the terrain at the
 * gap's midpoint -- the midpoint is the bottom of the channel, and a deck
 * placed there reads as a ramp sinking into the water.
 */
export function findStreamCrossing(sStart: number, sEnd: number): Crossing | null {
  let gapStart: number | null = null;
  let nearBankHeight = 0;
  let lastHeight = 0;

  for (let s = sStart; s <= sEnd; s += TRAIL_SAMPLE_STEP) {
    const point = pathPointAt(s);
    const worldX = point.x / PLANE_SCALE;
    const worldZ = point.y / PLANE_SCALE;

    if (inBridgeGap(worldX, worldZ)) {
      if (gapStart === null) {
        gapStart = s;
        nearBankHeight = lastHeight;
      }
      continue;
    }

    lastHeight = terrainHeight(worldX, worldZ);

    if (gapStart !== null) {
      const mid = (gapStart + s) / 2;
      const midPoint = pathPointAt(mid);
      const tangent = pathTangentAt(mid);
      return {
        position: [
          midPoint.x / PLANE_SCALE,
          (nearBankHeight + lastHeight) / 2 + TRAIL_SURFACE_LIFT,
          midPoint.y / PLANE_SCALE,
        ],
        yaw: Math.atan2(tangent.x, tangent.y),
        span: (s - gapStart) / PLANE_SCALE,
      };
    }
  }

  return null;
}

export interface BridgeFootprint {
  length: number;
  width: number;
}

export function bridgeFootprint(crossing: Crossing): BridgeFootprint {
  return {
    length: crossing.span + ABUTMENT_OVERLAP * 2,
    width: TRAIL_WIDTH * DECK_WIDTH_FACTOR,
  };
}
