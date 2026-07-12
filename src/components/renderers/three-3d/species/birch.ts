"use client";

import * as THREE from "three";
import type { SpeciesBuild } from "./types";
import { buildLimb, buildBranchSystem, buildRootFlare, scatterFoliageClumps } from "./organicBuilder";

const TRUNK_COLOR = new THREE.Color("#e8e4d8");
const LEAF_COLOR = new THREE.Color("#a8d08a"); // healthy light delicate green

/**
 * Birch: slender pale trunk with finer/higher-frequency bark noise than the
 * other species (suggests birch's horizontal lenticel banding rather than
 * rough furrows), fewer and narrower branches than oak/sakura, and a smaller
 * foliage clump count -- deliberately sparser/airier to keep the "delicate"
 * identity distinct from oak's broad canopy.
 */
export function buildBirch(rand: () => number): SpeciesBuild {
  const trunkHeight = 2.5;

  const trunk = buildLimb({
    rand,
    origin: new THREE.Vector3(0, 0, 0),
    direction: new THREE.Vector3(0, 1, 0),
    length: trunkHeight,
    baseRadius: 0.19,
    tipRadius: 0.075,
    segments: 6,
    wander: 0.08,
    bark: { amplitude: 0.012, frequency: 9, phase: rand() * 10 },
    radialSegments: 7,
  });

  const branches = buildBranchSystem({
    rand,
    trunkPoints: trunk.points,
    trunkTangents: trunk.tangents,
    primaryCount: 4,
    anchorRange: [0.5, 0.95],
    primaryLength: [1.0, 1.5],
    primaryRadius: [0.06, 0.095],
    spreadAngle: Math.PI * 0.3,
    secondaryPerPrimary: [1, 2],
    secondaryLengthFactor: 0.55,
    bark: { amplitude: 0.009, frequency: 8, phase: rand() * 10 },
  });

  const foliageClumps = scatterFoliageClumps({
    rand,
    anchors: branches.tips,
    perAnchor: [3, 5],
    jitterRadius: 0.45,
    scaleRange: [0.24, 0.4],
  });

  const roots = buildRootFlare({ rand, baseRadius: 0.19, count: [3, 4] });

  const parts: SpeciesBuild["parts"] = [...trunk.parts, ...branches.parts, ...roots].map((p) => ({
    geometry: p.geometry,
    color: TRUNK_COLOR,
    position: p.position,
    rotation: p.rotation,
  }));

  return {
    parts,
    foliageGeometry: new THREE.IcosahedronGeometry(1, 1),
    foliageColor: LEAF_COLOR,
    foliageClumps,
    height: trunkHeight + 2.2,
  };
}
