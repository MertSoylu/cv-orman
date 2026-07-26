"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { getWaterNormalTexture } from "../textures";
import { setUniform } from "../imperative";
import { streamDistance, streamFlow, streamHalfWidth, WATER_LEVEL } from "./heightfield";

/**
 * The stream surface.
 *
 * Real planar reflection would mean rendering the whole scene a second time
 * into a render target, which is the single most expensive thing this exhibit
 * could do and would blow the frame budget on mid-tier hardware. Instead the
 * shader reflects the *sky only*, evaluated analytically from the reflected
 * view vector using the same horizon/zenith colors the sky dome is using this
 * frame. Water almost always reflects sky rather than geometry at grazing
 * angles anyway, so the cheat reads as correct -- and it costs a few ALU ops
 * instead of a second scene pass.
 *
 * Two normal-map layers scroll against each other at different speeds and
 * scales, which is what stops the ripples from looking like one sliding
 * texture.
 */

const SHORE_FADE = 1.35;
/** Lateral samples per cross-section. Odd, so one lands on the centerline. */
const LATERAL_SAMPLES = 5;

const VERTEX_SHADER = /* glsl */ `
uniform float uTime;
attribute float aShore;
attribute float aFlow;
varying vec3 vWorldPosition;
varying vec2 vUvWorld;
varying float vShore;
varying float vFlow;
#include <common>
#include <fog_pars_vertex>

void main() {
  vShore = aShore;
  vFlow = aFlow;
  vec4 world = modelMatrix * vec4(position, 1.0);

  // A slow swell on top of the normal-map ripples, so the surface has some
  // silhouette movement at the banks and not just shading movement. Fast runs
  // chop rather than swell, so the wave shortens and quickens with the flow.
  float chop = 1.0 + aFlow * 1.9;
  float swell = sin(world.x * 0.55 * chop + uTime * 0.9 * chop) * 0.018
              + sin(world.z * 0.8 - uTime * 1.3 * chop) * 0.012;
  world.y += swell * (1.0 - vShore) * (1.0 + aFlow * 0.8);

  vWorldPosition = world.xyz;
  vUvWorld = world.xz;

  vec4 mvPosition = viewMatrix * world;
  #include <fog_vertex>
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
uniform sampler2D uRipples;
uniform float uTime;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyZenith;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
varying vec3 vWorldPosition;
varying vec2 vUvWorld;
varying float vShore;
varying float vFlow;
#include <common>
#include <fog_pars_fragment>

void main() {
  // Two ripple layers, different scale and drift, sampled as tangent-space
  // normals and blended. Both scroll *along* the channel (world +X) at a rate
  // set by the local flow, so the same surface reads as slack in the pools and
  // as a run where the banks pinch in -- one attribute, no second material.
  float drift = uTime * (0.4 + vFlow * 2.6);
  vec3 rippleA = texture2D(uRipples, vUvWorld * 0.11 + vec2(drift * 0.052, uTime * 0.013)).xyz * 2.0 - 1.0;
  vec3 rippleB = texture2D(uRipples, vUvWorld * 0.27 - vec2(drift * 0.040, uTime * 0.030)).xyz * 2.0 - 1.0;
  vec3 rippled = normalize(vec3(0.0, 1.0, 0.0) + (rippleA + rippleB) * vec3(0.42, 0.0, 0.42) * (1.0 + vFlow * 0.6));

  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float fresnel = pow(1.0 - clamp(dot(rippled, viewDir), 0.0, 1.0), 3.0);

  // Analytic sky reflection: the same gradient the dome draws, sampled along
  // the reflected view direction.
  vec3 reflected = reflect(-viewDir, rippled);
  vec3 sky = mix(uSkyHorizon, uSkyZenith, clamp(reflected.y * 1.4, 0.0, 1.0));

  // Specular glint off the sun, sharpened well past the diffuse lobe so it
  // reads as a highlight on moving water rather than a shiny plastic sheet.
  float glint = pow(clamp(dot(reflected, normalize(uSunDirection)), 0.0, 1.0), 220.0);

  vec3 body = mix(uDeepColor, uShallowColor, vShore);

  // Capped well short of a mirror. A physically-faithful fresnel takes this to
  // nearly 1.0 at the grazing angles the trail-level camera sees the stream
  // from -- and this scene's daytime horizon is a warm sand colour, so a
  // faithful surface renders as an exact colour match for the riverbank beside
  // it. Holding back at least a third of the water's own body colour is what
  // keeps it legible as water from every angle.
  float skyMix = clamp(fresnel * 0.6 + 0.1, 0.0, 0.54);
  vec3 color = mix(body, sky, skyMix);

  // Broad sheen toward the sun, plus the sharp glint. The wide lobe is what
  // makes the surface turn with the light rather than sit at one flat value.
  float sheen = pow(max(dot(rippled, normalize(uSunDirection)), 0.0), 6.0);
  color += uSunColor * sheen * 0.14 + uSunColor * glint * 1.6;

  // Whitewater. Foam belongs where fast water drags along an obstruction, which
  // in a channel means the banks -- so it is gated on flow *and* on proximity to
  // the shore, and torn up by the ripple normal so it breaks into streaks
  // instead of laying down as an even white band.
  float turbulence = clamp((rippleA.x + rippleB.z) * 0.9 + 0.5, 0.0, 1.0);
  float foam = smoothstep(0.45, 0.95, vShore) * vFlow * smoothstep(0.35, 0.85, turbulence);
  color = mix(color, vec3(0.92, 0.95, 0.95), foam * 0.75);

  // Fade out at the banks so the surface meets the ground in a wet margin
  // instead of a cut edge.
  float edge = 1.0 - smoothstep(0.55, 1.0, vShore);
  float alpha = clamp(mix(0.78, 0.96, fresnel) * edge + foam * 0.35, 0.0, 1.0);

  gl_FragColor = vec4(color, alpha);
  #include <fog_fragment>
}
`;

export interface WaterProps {
  /** Half-extent along world X that the stream should cover. */
  extent: number;
  /** Live sky colors, so the reflection tracks the day/night transition. */
  skyHorizon: THREE.Color;
  skyZenith: THREE.Color;
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
}

export default function Water({ extent, skyHorizon, skyZenith, sunDirection, sunColor }: WaterProps) {
  const geometry = useMemo(() => {
    // Cross-sections this far apart along the channel. Tight enough that the
    // meander and the width changes read as curves rather than as a chain of
    // facets at the waterline, and the whole strip is still a couple of thousand
    // vertices.
    const step = 1.1;
    const positions: number[] = [];
    const shores: number[] = [];
    const flows: number[] = [];
    const indices: number[] = [];

    let column = 0;
    for (let x = -extent; x <= extent; x += step, column++) {
      // The channel wanders *and* changes width, so the surface strip has to do
      // both -- a constant-width rectangle would ride up the bank on every bend
      // and either flood the narrows or leave dry bed in the pools.
      // `streamDistance(x, z) = z - wander(x)`, so sampling at z = 0 recovers
      // the centerline directly.
      const wander = -streamDistance(x, 0);
      const halfWidth = streamHalfWidth(x) * SHORE_FADE;
      const flow = streamFlow(x);

      // Laid out left bank -> centre -> right bank, so `aShore` is a clean 1..0..1
      // ramp and the strip can be indexed as a regular grid.
      for (let i = 0; i < LATERAL_SAMPLES; i++) {
        const t = (i / (LATERAL_SAMPLES - 1)) * 2 - 1;
        positions.push(x, WATER_LEVEL, wander + t * halfWidth);
        shores.push(Math.abs(t));
        flows.push(flow);
      }
    }

    for (let c = 0; c + 1 < column; c++) {
      const a = c * LATERAL_SAMPLES;
      const b = (c + 1) * LATERAL_SAMPLES;
      for (let i = 0; i + 1 < LATERAL_SAMPLES; i++) {
        indices.push(a + i, a + i + 1, b + i, a + i + 1, b + i + 1, b + i);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("aShore", new THREE.Float32BufferAttribute(shores, 1));
    geo.setAttribute("aFlow", new THREE.Float32BufferAttribute(flows, 1));
    geo.setIndex(indices);
    geo.computeBoundingSphere();
    return geo;
  }, [extent]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const uniforms = useMemo(
    () => ({
      // Fog uniforms are declared by hand rather than cloned from UniformsLib:
      // the clone produces plain `{ value }` literals, and the renderer's own
      // per-frame fog refresh would then be silently swallowed by the React
      // Compiler's dev-mode freeze. Every uniform here is a THREE.Uniform for
      // that reason -- see `imperative.ts`.
      fogColor: new THREE.Uniform(new THREE.Color(0xffffff)),
      fogNear: new THREE.Uniform(1),
      fogFar: new THREE.Uniform(2000),
      fogDensity: new THREE.Uniform(0.00025),
      uTime: new THREE.Uniform(0),
      uRipples: new THREE.Uniform(getWaterNormalTexture()),
      uDeepColor: new THREE.Uniform(new THREE.Color("#154043")),
      uShallowColor: new THREE.Uniform(new THREE.Color("#3f7c6f")),
      uSkyHorizon: new THREE.Uniform(skyHorizon.clone()),
      uSkyZenith: new THREE.Uniform(skyZenith.clone()),
      uSunDirection: new THREE.Uniform(sunDirection.clone()),
      uSunColor: new THREE.Uniform(sunColor.clone()),
    }),
    // Seeded once; the sky colours below are copied in every frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Built here rather than as a `<shaderMaterial uniforms={...}>` element.
  // Going through JSX hands the uniforms to the reconciler, which does not
  // guarantee the material ends up holding *this* object -- and a material
  // holding a detached copy animates for exactly zero frames while reporting no
  // error at all. Owning the material outright removes the question.
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        fog: true,
        side: THREE.DoubleSide,
      }),
    [uniforms],
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame(({ clock }) => {
    setUniform(uniforms.uTime, clock.elapsedTime);
    uniforms.uSkyHorizon.value.copy(skyHorizon);
    uniforms.uSkyZenith.value.copy(skyZenith);
    uniforms.uSunDirection.value.copy(sunDirection);
    uniforms.uSunColor.value.copy(sunColor);
  });

  return <mesh geometry={geometry} material={material} renderOrder={2} />;
}
