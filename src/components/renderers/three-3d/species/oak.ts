"use client";

import * as THREE from "three";
import type { SpeciesBuild } from "./types";
import { buildLimb, buildBranchSystem, buildRootFlare, scatterFoliageClumps } from "./organicBuilder";

const TRUNK_COLOR = new THREE.Color("#5c4530");
const CANOPY_COLOR = new THREE.Color("#4f7942"); // healthy deep oak green

/**
 * Oak: thick organically-tapered trunk with rough bark, 5 primary branches
 * spreading wide and forking into twigs, broad rounded canopy built from
 * ~60-90 small foliage clumps clustered around the twig tips.
 */
export function buildOak(rand: () => number): SpeciesBuild {
  const trunkHeight = 2.3;

  const trunk = buildLimb({
    rand,
    origin: new THREE.Vector3(0, 0, 0),
    direction: new THREE.Vector3(0, 1, 0),
    length: trunkHeight,
    baseRadius: 0.42,
    tipRadius: 0.16,
    segments: 6,
    wander: 0.12,
    bark: { amplitude: 0.025, frequency: 5, phase: rand() * 10 },
    radialSegments: 9,
  });

  const branches = buildBranchSystem({
    rand,
    trunkPoints: trunk.points,
    trunkTangents: trunk.tangents,
    primaryCount: 5,
    anchorRange: [0.45, 0.95],
    primaryLength: [1.3, 2.0],
    primaryRadius: [0.1, 0.16],
    spreadAngle: Math.PI * 0.4,
    secondaryPerPrimary: [2, 3],
    secondaryLengthFactor: 0.6,
    bark: { amplitude: 0.018, frequency: 6, phase: rand() * 10 },
  });

  const foliageClumps = scatterFoliageClumps({
    rand,
    anchors: branches.tips,
    perAnchor: [4, 6],
    jitterRadius: 0.6,
    scaleRange: [0.34, 0.6],
  });

  const roots = buildRootFlare({ rand, baseRadius: 0.42, count: [4, 6] });

  const parts: SpeciesBuild["parts"] = [...trunk.parts, ...branches.parts, ...roots].map((p) => ({
    geometry: p.geometry,
    color: TRUNK_COLOR,
    position: p.position,
    rotation: p.rotation,
  }));

  return {
    parts,
    foliageGeometry: new THREE.IcosahedronGeometry(1, 1),
    foliageColor: CANOPY_COLOR,
    foliageClumps,
    height: trunkHeight + 3.2,
  };
}
