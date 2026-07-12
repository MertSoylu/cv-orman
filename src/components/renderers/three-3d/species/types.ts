"use client";

import * as THREE from "three";

/**
 * One trunk/branch/twig segment: a tapered, bark-noised cylinder mesh.
 * Always wood -- never recolored by health, always rendered at "trunk"
 * roughness. Foliage lives separately in `SpeciesBuild.foliageClumps` so it
 * can be instanced instead of rendered as individual meshes.
 */
export interface MeshPart {
  geometry: THREE.BufferGeometry;
  color: THREE.Color;
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number];
}

/** One instanced foliage clump's local transform, relative to the tree's origin. */
export interface FoliageClump {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
}

/** Static geometry recipe for a species variant, independent of any single tree instance. */
export interface SpeciesBuild {
  parts: MeshPart[];
  /** Shared unit-radius icosphere template instanced for every entry in `foliageClumps`. Null for species with no foliage mass (palm). */
  foliageGeometry: THREE.BufferGeometry | null;
  /** Healthy-state base color before health-driven wilt interpolation. */
  foliageColor: THREE.Color;
  foliageClumps: FoliageClump[];
  /** World-space height of the whole assembly at scale=1, for camera/spacing purposes. */
  height: number;
}
