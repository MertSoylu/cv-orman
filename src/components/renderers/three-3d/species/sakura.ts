"use client";

import * as THREE from "three";
import type { SpeciesBuild } from "./types";
import { buildLimb, buildBranchSystem, buildRootFlare, scatterFoliageClumps } from "./organicBuilder";

const TRUNK_COLOR = new THREE.Color("#6b4a42");
const BLOSSOM_COLOR = new THREE.Color("#f4a6c6"); // healthy vibrant sakura pink

/**
 * Sakura: slender trunk, 5 primary branches forking wide and upward (a
 * bigger spread angle than oak so the canopy reads as airy/open rather than
 * dense/broad), each forking into 2-4 twigs, with smaller and more numerous
 * blossom clumps than oak's leaf clumps for a softer, finer-grained canopy.
 */
export function buildSakura(rand: () => number): SpeciesBuild {
  const trunkHeight = 1.9;

  const trunk = buildLimb({
    rand,
    origin: new THREE.Vector3(0, 0, 0),
    direction: new THREE.Vector3(0, 1, 0),
    length: trunkHeight,
    baseRadius: 0.24,
    tipRadius: 0.1,
    segments: 5,
    wander: 0.14,
    bark: { amplitude: 0.016, frequency: 5, phase: rand() * 10 },
    radialSegments: 8,
  });

  const branches = buildBranchSystem({
    rand,
    trunkPoints: trunk.points,
    trunkTangents: trunk.tangents,
    primaryCount: 5,
    anchorRange: [0.4, 0.95],
    primaryLength: [1.4, 2.1],
    primaryRadius: [0.07, 0.12],
    spreadAngle: Math.PI * 0.55,
    secondaryPerPrimary: [2, 4],
    secondaryLengthFactor: 0.65,
    bark: { amplitude: 0.012, frequency: 5, phase: rand() * 10 },
  });

  const foliageClumps = scatterFoliageClumps({
    rand,
    anchors: branches.tips,
    perAnchor: [4, 6],
    jitterRadius: 0.62,
    scaleRange: [0.22, 0.4],
  });

  const roots = buildRootFlare({ rand, baseRadius: 0.24, count: [3, 5] });

  const parts: SpeciesBuild["parts"] = [...trunk.parts, ...branches.parts, ...roots].map((p) => ({
    geometry: p.geometry,
    color: TRUNK_COLOR,
    position: p.position,
    rotation: p.rotation,
  }));

  return {
    parts,
    foliageGeometry: new THREE.IcosahedronGeometry(1, 1),
    foliageColor: BLOSSOM_COLOR,
    foliageClumps,
    height: trunkHeight + 2.6,
  };
}
