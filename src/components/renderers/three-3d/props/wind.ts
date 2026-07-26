"use client";

import * as THREE from "three";
import { mergeGeometries } from "../trees/species/builder";

/**
 * Wind for instanced card foliage -- grass, shrubs, reeds.
 *
 * Shared by every field of cards in the scene so they all bend off one clock:
 * two fields animating from two uniforms drift apart within seconds, and a
 * gust that crosses the grass but not the reeds beside it reads as a bug
 * immediately.
 */
export interface WindUniforms {
  uTime: THREE.IUniform<number>;
  uWindStrength: THREE.IUniform<number>;
}

/**
 * Bend an instanced card by the square of its own local height, phased by the
 * instance's world position. Reading the phase out of `instanceMatrix` rather
 * than an extra attribute means the whole field animates with no per-instance
 * data upload at all.
 */
export function applyWind(
  material: THREE.Material,
  uniforms: WindUniforms,
  key: string,
  amount: number,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>\nuniform float uTime;\nuniform float uWindStrength;`,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        float bladeHeight = max(transformed.y, 0.0);
        float phase = instanceMatrix[3][0] * 0.63 + instanceMatrix[3][2] * 0.91;
        float gust = sin(uTime * 1.25 + phase) * 0.7 + sin(uTime * 2.7 + phase * 1.6) * 0.3;
        transformed.x += gust * bladeHeight * bladeHeight * ${amount.toFixed(3)} * uWindStrength;
        transformed.z += gust * bladeHeight * bladeHeight * ${(amount * 0.6).toFixed(3)} * uWindStrength;
        `,
      );
  };
  material.customProgramCacheKey = () => key;
}

/** Quads crossed at even angles, standing on the ground plane. */
export function crossedCards(planes: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < planes; i++) {
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.translate(0, 0.5, 0);
    plane.rotateY((i / planes) * Math.PI);
    parts.push(plane);
  }
  return mergeGeometries(parts);
}
