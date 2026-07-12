"use client";

import * as THREE from "three";
import type { SpeciesBuild } from "./types";
import { buildLimb, buildRootFlare, quatFromTo, eulerArrayFromQuat } from "./organicBuilder";

const TRUNK_COLOR = new THREE.Color("#8a6a3f");
const FROND_COLOR = new THREE.Color("#5fae3c"); // healthy bright tropical green

/**
 * Palm: deliberately the most different silhouette of the six -- no canopy
 * mass at all (foliageClumps stays empty), just a pronounced leaning/curving
 * trunk (higher `wander` than any other species) with faint ring-like bark
 * banding, and a fan of curved, drooping frond blades radiating from the
 * top. Fronds keep the radial symmetry that's correct for a palm crown
 * (explicitly the one species allowed to look symmetric), but each frond's
 * length/droop is still seeded per-tree so the fan isn't a perfect clone
 * stamp.
 */
export function buildPalm(rand: () => number): SpeciesBuild {
  const trunkHeight = 3.6;

  const trunk = buildLimb({
    rand,
    origin: new THREE.Vector3(0, 0, 0),
    direction: new THREE.Vector3(0, 1, 0),
    length: trunkHeight,
    baseRadius: 0.22,
    tipRadius: 0.09,
    segments: 7,
    wander: 0.22,
    bark: { amplitude: 0.02, frequency: 14, phase: rand() * 10 },
    radialSegments: 8,
  });

  const trunkTip = trunk.points[trunk.points.length - 1];
  const frondCount = 8;
  const frondParts: SpeciesBuild["parts"] = [];

  for (let i = 0; i < frondCount; i++) {
    const azimuth = (i / frondCount) * Math.PI * 2 + (rand() - 0.5) * 0.25;
    for (const part of buildFrond(rand, trunkTip, azimuth)) {
      frondParts.push({ ...part, color: FROND_COLOR });
    }
  }

  const trunkParts: SpeciesBuild["parts"] = [...trunk.parts, ...buildRootFlare({ rand, baseRadius: 0.22, count: [3, 4] })].map((p) => ({
    geometry: p.geometry,
    color: TRUNK_COLOR,
    position: p.position,
    rotation: p.rotation,
  }));

  return {
    parts: [...trunkParts, ...frondParts],
    foliageGeometry: null,
    foliageColor: FROND_COLOR,
    foliageClumps: [],
    height: trunkHeight + 2.3,
  };
}

/** One frond: 3 stacked, flattened, tapered segments drooping outward from horizontal with accelerating curve toward the tip. */
function buildFrond(
  rand: () => number,
  origin: THREE.Vector3,
  azimuth: number
): { geometry: THREE.BufferGeometry; position: [number, number, number]; rotation: [number, number, number] }[] {
  const horizontal = new THREE.Vector3(Math.cos(azimuth), 0, Math.sin(azimuth));
  const down = new THREE.Vector3(0, -1, 0);
  const segCount = 3;
  const totalLength = THREE.MathUtils.lerp(1.9, 2.7, rand());
  // Thick enough to read as a blade at typical camera distance, not a hairline.
  const baseRadius = THREE.MathUtils.lerp(0.09, 0.13, rand());
  const segLen = totalLength / segCount;

  const parts: { geometry: THREE.BufferGeometry; position: [number, number, number]; rotation: [number, number, number] }[] = [];
  let cursor = origin.clone();
  for (let s = 0; s < segCount; s++) {
    const droopT = Math.pow(s / (segCount - 1), 1.4); // accelerating droop toward the tip
    const dir = horizontal.clone().lerp(down, 0.15 + droopT * 0.7).normalize();
    const next = cursor.clone().addScaledVector(dir, segLen);
    const mid = cursor.clone().add(next).multiplyScalar(0.5);

    const rTop = THREE.MathUtils.lerp(baseRadius, 0.02, (s + 1) / segCount);
    const rBottom = THREE.MathUtils.lerp(baseRadius, 0.02, s / segCount);
    const geometry = new THREE.CylinderGeometry(rTop, rBottom, segLen * 1.2, 5, 1);
    geometry.scale(1, 1, 0.22); // flatten into a blade cross-section

    parts.push({ geometry, position: [mid.x, mid.y, mid.z], rotation: eulerArrayFromQuat(quatFromTo(dir)) });
    cursor = next;
  }
  return parts;
}
