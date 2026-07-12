"use client";

import * as THREE from "three";
import type { SpeciesBuild } from "./types";
import { buildLimb, buildBranchSystem, buildRootFlare, scatterFoliageClumps } from "./organicBuilder";

const TRUNK_COLOR = new THREE.Color("#4a3a28");
const NEEDLE_COLOR = new THREE.Color("#1f4d2c"); // healthy deep evergreen

/**
 * Pine: mostly-straight trunk, short stub branches in 3 height bands, and
 * needle clumps deliberately scattered into a tapering CONE per band (wide
 * low, narrow high) plus a pointed spire at the tip -- this is what keeps
 * the classic tiered-evergreen silhouette even though the foliage itself is
 * now many small clumps instead of 3 smooth cones.
 */
export function buildPine(rand: () => number): SpeciesBuild {
  // Tallest, narrowest trunk of the branched species -- a classic pine
  // silhouette is tall-and-narrow, not squat, which also keeps the conical
  // canopy legible at a distance instead of reading as one round blob.
  const trunkHeight = 2.1;

  const trunk = buildLimb({
    rand,
    origin: new THREE.Vector3(0, 0, 0),
    direction: new THREE.Vector3(0, 1, 0),
    length: trunkHeight,
    baseRadius: 0.22,
    tipRadius: 0.08,
    segments: 6,
    wander: 0.06,
    bark: { amplitude: 0.014, frequency: 7, phase: rand() * 10 },
    radialSegments: 8,
  });

  const branches = buildBranchSystem({
    rand,
    trunkPoints: trunk.points,
    trunkTangents: trunk.tangents,
    primaryCount: 6,
    anchorRange: [0.3, 0.92],
    primaryLength: [0.35, 0.6],
    primaryRadius: [0.05, 0.08],
    spreadAngle: Math.PI * 0.38,
    secondaryPerPrimary: [0, 0],
    bark: { amplitude: 0.012, frequency: 6, phase: rand() * 10 },
  });

  // Tiered conical foliage bands: wide near the bottom of the canopy,
  // narrowing toward the top, each ring of anchor points jittered around a
  // circle at that tier's radius. Bands start at 42% up the trunk (not the
  // base) so a visible stretch of bare trunk shows beneath the canopy --
  // without that gap the lowest tier's radius swallows the trunk and the
  // whole tree reads as one undifferentiated blob instead of a tree.
  const tierCount = 3;
  const bandAnchors: THREE.Vector3[] = [];
  for (let tier = 0; tier < tierCount; tier++) {
    const tFrac = 0.42 + (tier / (tierCount - 1)) * 0.5;
    const idx = Math.round(tFrac * (trunk.points.length - 1));
    const center = trunk.points[idx];
    const tierRadius = THREE.MathUtils.lerp(0.95, 0.28, tier / (tierCount - 1));
    const ringCount = 10 - tier * 2;
    for (let i = 0; i < ringCount; i++) {
      const angle = (i / ringCount) * Math.PI * 2 + rand() * 0.5;
      const r = tierRadius * (0.6 + rand() * 0.4);
      bandAnchors.push(new THREE.Vector3(center.x + Math.cos(angle) * r, center.y + (rand() - 0.3) * 0.3, center.z + Math.sin(angle) * r));
    }
  }
  // Pointed spire at the very top.
  bandAnchors.push(trunk.points[trunk.points.length - 1].clone());

  const foliageClumps = scatterFoliageClumps({
    rand,
    anchors: [...bandAnchors, ...branches.tips],
    perAnchor: [2, 3],
    jitterRadius: 0.26,
    scaleRange: [0.22, 0.38],
  });

  const roots = buildRootFlare({ rand, baseRadius: 0.22, count: [3, 4] });

  const parts: SpeciesBuild["parts"] = [...trunk.parts, ...branches.parts, ...roots].map((p) => ({
    geometry: p.geometry,
    color: TRUNK_COLOR,
    position: p.position,
    rotation: p.rotation,
  }));

  return {
    parts,
    foliageGeometry: new THREE.IcosahedronGeometry(1, 1),
    foliageColor: NEEDLE_COLOR,
    foliageClumps,
    height: trunkHeight + 3.6,
  };
}
