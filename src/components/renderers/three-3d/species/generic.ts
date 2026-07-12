"use client";

import * as THREE from "three";
import type { SpeciesBuild } from "./types";
import { buildLimb, scatterFoliageClumps } from "./organicBuilder";

const TRUNK_COLOR = new THREE.Color("#5c4530");
const CANOPY_COLOR = new THREE.Color("#6b9e5e"); // healthy neutral mid-green

/**
 * Generic fallback: deliberately the plainest species -- a single straight
 * tapered trunk (segments=1, wander=0, no bark noise -- buildLimb collapses
 * to one plain cylinder), no branches at all, and one loose cluster of
 * foliage clumps around the trunk top. Upgraded just enough to match the
 * "many small clumps, not one balloon" foliage treatment every other
 * species gets, while staying visibly simpler than the branched ones.
 */
export function buildGeneric(rand: () => number): SpeciesBuild {
  const trunkHeight = 1.9;

  const trunk = buildLimb({
    rand,
    origin: new THREE.Vector3(0, 0, 0),
    direction: new THREE.Vector3(0, 1, 0),
    length: trunkHeight,
    baseRadius: 0.24,
    tipRadius: 0.13,
    segments: 1,
    wander: 0,
    bark: null,
    radialSegments: 8,
  });

  const foliageClumps = scatterFoliageClumps({
    rand,
    anchors: [trunk.points[trunk.points.length - 1]],
    perAnchor: [9, 12],
    jitterRadius: 0.85,
    scaleRange: [0.38, 0.6],
  });

  const parts: SpeciesBuild["parts"] = trunk.parts.map((p) => ({
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
    height: trunkHeight + 2.1,
  };
}
