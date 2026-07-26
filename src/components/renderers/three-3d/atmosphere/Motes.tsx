"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { seededRandom } from "../utils";
import { setUniform } from "../imperative";
import { terrainHeight } from "../terrain/heightfield";

/**
 * Airborne specks: fireflies after dark, drifting pollen by day.
 *
 * One Points cloud, one draw call, and the entire drift animation lives in the
 * vertex shader driven by a time uniform and a per-point seed. The previous
 * renderer moved a BufferAttribute on the CPU every frame for the same effect;
 * this version uploads nothing after mount, and `uMotion` drops to zero under
 * reduced motion rather than the frame callback being skipped (which would
 * freeze them mid-drift instead of settling them).
 */

const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
uniform float uMotion;
uniform float uSize;
uniform float uPixelRatio;
attribute float aSeed;
attribute float aScale;
varying float vSeed;

void main() {
  vSeed = aSeed;
  vec3 drifted = position;

  float t = uTime * (0.18 + aSeed * 0.22);
  drifted.x += sin(t * 1.7 + aSeed * 24.0) * 1.6 * uMotion;
  drifted.y += sin(t * 2.3 + aSeed * 41.0) * 0.55 * uMotion;
  drifted.z += cos(t * 1.4 + aSeed * 17.0) * 1.6 * uMotion;

  vec4 mvPosition = modelViewMatrix * vec4(drifted, 1.0);
  gl_PointSize = uSize * aScale * uPixelRatio * (14.0 / -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uFlicker;
varying float vSeed;

void main() {
  // Round sprite with a soft falloff, cut before the quad's corners so the
  // points never read as squares at close range.
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float alpha = smoothstep(0.5, 0.05, d);

  float pulse = mix(1.0, 0.35 + 0.65 * sin(uTime * 3.1 + vSeed * 62.0) * 0.5 + 0.5, uFlicker);

  gl_FragColor = vec4(uColor, alpha * uOpacity * pulse);
}
`;

export interface MotesProps {
  count: number;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  isDark: boolean;
  reducedMotion: boolean;
  pixelRatio: number;
}

const DAY_COLOR = new THREE.Color("#f4e6c4");
const NIGHT_COLOR = new THREE.Color("#ffd27a");

export default function Motes({ count, bounds, isDark, reducedMotion, pixelRatio }: MotesProps) {
  const dayFactor = useRef(isDark ? 0 : 1);

  const geometry = useMemo(() => {
    const rand = seededRandom("motes");
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    const scales = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const x = THREE.MathUtils.lerp(bounds.minX, bounds.maxX, rand());
      const z = THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, rand());
      // Sit them in the canopy band rather than uniformly through the volume,
      // which is where they actually read against the trees.
      positions[i * 3] = x;
      positions[i * 3 + 1] = terrainHeight(x, z) + 0.6 + rand() * 5.4;
      positions[i * 3 + 2] = z;
      seeds[i] = rand();
      scales[i] = 0.5 + rand() * 0.9;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute("aScale", new THREE.BufferAttribute(scales, 1));
    geo.computeBoundingSphere();
    return geo;
  }, [count, bounds]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      // THREE.Uniform, not `{ value }` -- see `imperative.ts`.
      uTime: new THREE.Uniform(0),
      uMotion: new THREE.Uniform(reducedMotion ? 0 : 1),
      uSize: new THREE.Uniform(5.5),
      uPixelRatio: new THREE.Uniform(pixelRatio),
      uColor: new THREE.Uniform((isDark ? NIGHT_COLOR : DAY_COLOR).clone()),
      uOpacity: new THREE.Uniform(0.65),
      uFlicker: new THREE.Uniform(isDark ? 1 : 0),
    }),
    // Seeded once; driven imperatively from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Built here, not as a `<shaderMaterial uniforms={...}>` element -- passing
  // uniforms through JSX does not guarantee the material holds *this* object.
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [uniforms],
  );

  useEffect(() => () => material.dispose(), [material]);

  useEffect(() => {
    setUniform(uniforms.uMotion, reducedMotion ? 0 : 1);
    setUniform(uniforms.uPixelRatio, pixelRatio);
  }, [reducedMotion, pixelRatio, uniforms]);

  useFrame(({ clock }, delta) => {
    setUniform(uniforms.uTime, clock.elapsedTime);
    dayFactor.current = reducedMotion
      ? isDark
        ? 0
        : 1
      : THREE.MathUtils.damp(dayFactor.current, isDark ? 0 : 1, 1.6, delta);

    uniforms.uColor.value.copy(NIGHT_COLOR).lerp(DAY_COLOR, dayFactor.current);
    // Fireflies read strongly at night; by day the same specks become faint
    // pollen, so opacity drops rather than the cloud being swapped out.
    setUniform(uniforms.uOpacity, THREE.MathUtils.lerp(0.85, 0.28, dayFactor.current));
    setUniform(uniforms.uFlicker, 1 - dayFactor.current);
  });

  if (count === 0) return null;

  return <points geometry={geometry} material={material} frustumCulled={false} />;
}
