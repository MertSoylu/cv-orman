"use client";

import * as THREE from "three";
import type { FoliageClump } from "./types";

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Seeded sine-based fake bark displacement -- amplitude/frequency are species-tuned, phase is drawn from the build's seeded RNG so it varies per limb without being random per vertex. */
export interface BarkNoise {
  amplitude: number;
  frequency: number;
  phase: number;
}

export interface LimbPart {
  geometry: THREE.BufferGeometry;
  position: [number, number, number];
  rotation: [number, number, number];
}

export interface LimbResult {
  parts: LimbPart[];
  /** Sampled curve points root -> tip, in the same local space as `origin`. Used to anchor child branches/foliage. */
  points: THREE.Vector3[];
  /** Tangent direction at each `points` entry. */
  tangents: THREE.Vector3[];
}

export interface LimbOptions {
  rand: () => number;
  origin: THREE.Vector3;
  direction: THREE.Vector3;
  length: number;
  baseRadius: number;
  tipRadius: number;
  /** Number of stacked tapered-cylinder segments. 1 = a single straight tapered cylinder (no curve). */
  segments?: number;
  /** Lateral wander strength as a fraction of length, 0 = perfectly straight spine. */
  wander?: number;
  bark?: BarkNoise | null;
  radialSegments?: number;
}

export function quatFromTo(dir: THREE.Vector3): THREE.Quaternion {
  return new THREE.Quaternion().setFromUnitVectors(WORLD_UP, dir);
}

export function eulerArrayFromQuat(q: THREE.Quaternion): [number, number, number] {
  const e = new THREE.Euler().setFromQuaternion(q);
  return [e.x, e.y, e.z];
}

/** Push seeded radial sine displacement into a cylinder's vertices to fake bark detail, then refresh normals. */
function applyBarkNoise(geometry: THREE.CylinderGeometry, bark: BarkNoise): void {
  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const radial = Math.sqrt(v.x * v.x + v.z * v.z);
    if (radial < 1e-6) continue; // cap-center vertices have no radial direction to displace along
    const angle = Math.atan2(v.z, v.x);
    const displacement =
      bark.amplitude * Math.sin(angle * bark.frequency + bark.phase) * Math.sin(v.y * bark.frequency * 1.7 + bark.phase * 1.3);
    const factor = (radial + displacement) / radial;
    pos.setXYZ(i, v.x * factor, v.y, v.z * factor);
  }
  pos.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Build one curved, tapered limb (trunk, branch, or twig) as a chain of
 * stacked tapered cylinder segments following a CatmullRomCurve3 spine: a
 * few coarse control points define a gentle bend, then the curve is sampled
 * at `segments` even arc-length steps so each stacked segment follows the
 * local tangent and tapers from `baseRadius` to `tipRadius`.
 */
export function buildLimb(opts: LimbOptions): LimbResult {
  const segments = Math.max(1, opts.segments ?? 5);
  const wander = opts.wander ?? 0;
  const radialSegments = opts.radialSegments ?? 7;
  const rand = opts.rand;

  const dir = opts.direction.clone().normalize();
  const right = new THREE.Vector3().crossVectors(dir, WORLD_UP);
  if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
  right.normalize();
  const up2 = new THREE.Vector3().crossVectors(right, dir).normalize();

  // Coarse control points for the spine: walk forward in `direction`,
  // nudging sideways a little each step so the spine bends organically
  // instead of running die-straight. wander=0 collapses every offset to 0,
  // i.e. a perfectly straight spine (used by the generic species).
  const controlCount = 4;
  const stepLen = opts.length / (controlCount - 1);
  const controlPoints: THREE.Vector3[] = [opts.origin.clone()];
  let cursor = opts.origin.clone();
  for (let i = 1; i < controlCount; i++) {
    const lateral = (rand() - 0.5) * wander * opts.length;
    const vertical = (rand() - 0.5) * wander * opts.length * 0.4;
    cursor = cursor.clone().addScaledVector(dir, stepLen).addScaledVector(right, lateral).addScaledVector(up2, vertical);
    controlPoints.push(cursor);
  }

  const curve = new THREE.CatmullRomCurve3(controlPoints, false, "catmullrom", 0.4);
  const points = curve.getSpacedPoints(segments);
  const tangents = points.map((_, i) => curve.getTangentAt(Math.min(i / segments, 1)));

  const parts: LimbPart[] = [];
  for (let i = 0; i < segments; i++) {
    const p0 = points[i];
    const p1 = points[i + 1];
    const segDir = new THREE.Vector3().subVectors(p1, p0);
    const segLength = segDir.length() || 0.001;
    segDir.normalize();

    const radiusBottom = THREE.MathUtils.lerp(opts.baseRadius, opts.tipRadius, i / segments);
    const radiusTop = THREE.MathUtils.lerp(opts.baseRadius, opts.tipRadius, (i + 1) / segments);

    // 1.15x overlap hides seams at the joints between stacked segments.
    const geometry = new THREE.CylinderGeometry(radiusTop, radiusBottom, segLength * 1.15, radialSegments, 3);
    if (opts.bark) {
      applyBarkNoise(geometry, { ...opts.bark, phase: opts.bark.phase + i * 0.9 });
    }

    const mid = new THREE.Vector3().addVectors(p0, p1).multiplyScalar(0.5);
    parts.push({
      geometry,
      position: [mid.x, mid.y, mid.z],
      rotation: eulerArrayFromQuat(quatFromTo(segDir)),
    });
  }

  return { parts, points, tangents };
}

export interface BranchSystemOptions {
  rand: () => number;
  trunkPoints: THREE.Vector3[];
  trunkTangents: THREE.Vector3[];
  primaryCount: number;
  /** [min,max] fraction along trunkPoints to fork primary branches from. */
  anchorRange: [number, number];
  primaryLength: [number, number];
  primaryRadius: [number, number];
  /** Radians: how far a branch tilts away from the trunk's local tangent toward horizontal. */
  spreadAngle: number;
  secondaryPerPrimary?: [number, number];
  secondaryLengthFactor?: number;
  bark?: BarkNoise | null;
}

export interface BranchSystemResult {
  parts: LimbPart[];
  /** Endpoint of every twig (or bare primary branch, if it grew no twigs) -- foliage clump anchors. */
  tips: THREE.Vector3[];
}

/**
 * Fork `primaryCount` branches off a trunk at organic, irregular angles
 * (azimuth + tilt both seeded, never radially symmetric), each optionally
 * forking again into a few secondary twigs. Returns every twig/branch tip so
 * the caller can scatter foliage clumps around them.
 */
export function buildBranchSystem(opts: BranchSystemOptions): BranchSystemResult {
  const rand = opts.rand;
  const parts: LimbPart[] = [];
  const tips: THREE.Vector3[] = [];
  const lastIdx = opts.trunkPoints.length - 1;
  const [secMin, secMax] = opts.secondaryPerPrimary ?? [0, 0];
  const secondaryLengthFactor = opts.secondaryLengthFactor ?? 0.55;
  const tiltFraction = opts.spreadAngle / (Math.PI / 2);

  for (let b = 0; b < opts.primaryCount; b++) {
    const tFrac = THREE.MathUtils.lerp(opts.anchorRange[0], opts.anchorRange[1], rand());
    const idx = THREE.MathUtils.clamp(Math.round(tFrac * lastIdx), 1, lastIdx);
    const anchor = opts.trunkPoints[idx];
    const trunkDir = opts.trunkTangents[idx];

    const azimuth = rand() * Math.PI * 2;
    const horizontal = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
    const branchDir = trunkDir.clone().lerp(horizontal, tiltFraction * (0.4 + rand() * 0.6)).normalize();

    const length = THREE.MathUtils.lerp(opts.primaryLength[0], opts.primaryLength[1], rand());
    const baseRadius = THREE.MathUtils.lerp(opts.primaryRadius[0], opts.primaryRadius[1], rand());
    const tipRadius = baseRadius * 0.4;

    const limb = buildLimb({
      rand,
      origin: anchor,
      direction: branchDir,
      length,
      baseRadius,
      tipRadius,
      segments: 3,
      wander: 0.3,
      bark: opts.bark ?? null,
      radialSegments: 6,
    });
    parts.push(...limb.parts);

    const twigCount = Math.round(THREE.MathUtils.lerp(secMin, secMax, rand()));
    if (twigCount === 0) {
      tips.push(limb.points[limb.points.length - 1]);
      continue;
    }

    for (let s = 0; s < twigCount; s++) {
      const srcIdx = THREE.MathUtils.clamp(limb.points.length - 1 - Math.floor(rand() * 2), 1, limb.points.length - 1);
      const twigAzimuth = rand() * Math.PI * 2;
      const twigHorizontal = new THREE.Vector3(Math.sin(twigAzimuth), 0, Math.cos(twigAzimuth));
      const twigDir = limb.tangents[srcIdx].clone().lerp(twigHorizontal, 0.3 + rand() * 0.35).normalize();
      const twigLength = length * secondaryLengthFactor * (0.7 + rand() * 0.6);
      const twigBase = tipRadius * (0.6 + rand() * 0.3);

      const twig = buildLimb({
        rand,
        origin: limb.points[srcIdx],
        direction: twigDir,
        length: twigLength,
        baseRadius: twigBase,
        tipRadius: twigBase * 0.35,
        segments: 2,
        wander: 0.35,
        bark: opts.bark ?? null,
        radialSegments: 5,
      });
      parts.push(...twig.parts);
      tips.push(twig.points[twig.points.length - 1]);
    }
  }

  return { parts, tips };
}

export interface RootFlareOptions {
  rand: () => number;
  /** Trunk base radius the roots fan out from. */
  baseRadius: number;
  /** [min,max] root count. */
  count?: [number, number];
}

/**
 * Short buttress roots fanning out and diving down from the trunk base, so
 * the tree grips the soil instead of ending in a clean cylinder-meets-plane
 * seam. Each root starts slightly up the trunk wall and curves outward-down.
 */
export function buildRootFlare(opts: RootFlareOptions): LimbPart[] {
  const rand = opts.rand;
  const [minCount, maxCount] = opts.count ?? [4, 6];
  const count = Math.round(THREE.MathUtils.lerp(minCount, maxCount, rand()));
  const down = new THREE.Vector3(0, -1, 0);
  const parts: LimbPart[] = [];

  for (let i = 0; i < count; i++) {
    const azimuth = (i / count) * Math.PI * 2 + rand() * 0.8;
    const outward = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
    const direction = outward.clone().lerp(down, 0.5 + rand() * 0.2).normalize();
    const length = opts.baseRadius * (1.7 + rand() * 1.2);
    const rootRadius = opts.baseRadius * (0.28 + rand() * 0.16);
    const origin = new THREE.Vector3(
      outward.x * opts.baseRadius * 0.4,
      opts.baseRadius * (0.6 + rand() * 0.35),
      outward.z * opts.baseRadius * 0.4
    );

    const limb = buildLimb({
      rand,
      origin,
      direction,
      length,
      baseRadius: rootRadius,
      tipRadius: rootRadius * 0.25,
      segments: 2,
      wander: 0.25,
      bark: null,
      radialSegments: 5,
    });
    parts.push(...limb.parts);
  }

  return parts;
}

export interface ScatterOptions {
  rand: () => number;
  anchors: THREE.Vector3[];
  /** [min,max] clump count per anchor point. */
  perAnchor: [number, number];
  jitterRadius: number;
  scaleRange: [number, number];
}

/**
 * Scatter many small foliage clumps in a jittered sphere around each anchor
 * point (branch/twig tip), each with randomized position offset, rotation,
 * and slightly non-uniform scale -- reads as leaf mass instead of one smooth
 * balloon, while staying cheap since the caller instances a single shared
 * icosphere geometry across every returned clump.
 */
export function scatterFoliageClumps(opts: ScatterOptions): FoliageClump[] {
  const rand = opts.rand;
  const clumps: FoliageClump[] = [];

  for (const anchor of opts.anchors) {
    const count = Math.round(THREE.MathUtils.lerp(opts.perAnchor[0], opts.perAnchor[1], rand()));
    for (let i = 0; i < count; i++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(2 * rand() - 1);
      const r = opts.jitterRadius * (0.3 + rand() * 0.7);
      const ox = r * Math.sin(phi) * Math.cos(theta);
      const oy = r * Math.cos(phi) * 0.7; // flatten the jitter sphere vertically a touch
      const oz = r * Math.sin(phi) * Math.sin(theta);

      const s = THREE.MathUtils.lerp(opts.scaleRange[0], opts.scaleRange[1], rand());
      clumps.push({
        position: [anchor.x + ox, anchor.y + oy, anchor.z + oz],
        rotation: [rand() * Math.PI, rand() * Math.PI, rand() * Math.PI],
        scale: [s * (0.82 + rand() * 0.36), s * (0.82 + rand() * 0.36), s * (0.82 + rand() * 0.36)],
      });
    }
  }

  return clumps;
}
