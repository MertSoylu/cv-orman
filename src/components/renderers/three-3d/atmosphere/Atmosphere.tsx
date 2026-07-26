"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { setUniform } from "../imperative";
import type { SkyState } from "./skyState";

/**
 * Sky dome, fog, the three scene lights, and a visible sun and moon.
 *
 * The theme toggle is an *animation*, not a swap: a single `dayFactor` eases
 * toward the target and every value in this file is lerped off it each frame --
 * sky gradient, fog color, light colors and intensities, and the elevation of
 * both celestial bodies on their arc. Flipping the site's dark mode therefore
 * plays a sunset: the sun sinks, the key light reddens and dims, the moon rises
 * on the opposite azimuth, and stars fade up.
 *
 * Every JSX prop below is a *mount-time seed only*. The frame loop overwrites
 * all of them imperatively. Do not move these values back onto React props --
 * that is what makes the transition snap instead of ease.
 */

const DAY = {
  horizon: new THREE.Color("#f0d9ae"),
  zenith: new THREE.Color("#5f93c6"),
  ground: new THREE.Color("#8d8163"),
  sun: new THREE.Color("#ffeaca"),
  key: new THREE.Color("#ffdfb2"),
  keyIntensity: 3.2,
  ambient: new THREE.Color("#c6d5ea"),
  ambientIntensity: 0.46,
  hemiSky: new THREE.Color("#b6cee9"),
  hemiGround: new THREE.Color("#6d6249"),
  hemiIntensity: 0.8,
  fog: new THREE.Color("#dcc9a7"),
  /**
   * Sun elevation, radians above the horizon.
   *
   * Deliberately late afternoon rather than midday. At the old 0.66 the key
   * light came down almost on top of the trees, which flattens a forest: every
   * canopy is lit uniformly, every shadow pools directly underneath, and the
   * walk itself reads as an evenly-lit strip. Dropped to a raking angle, each
   * specimen lays a bar of shadow **across** the gravel -- and since the stations
   * are evenly spaced, those bars come out evenly spaced too, which is the
   * cheapest rhythm in the scene and the one that most makes the walk read as a
   * walk. It also brings the sun down into the frustum, so the god-ray pass
   * finally has something on screen to shaft off.
   */
  sunElevation: 0.28,
};

const NIGHT = {
  horizon: new THREE.Color("#2c3549"),
  zenith: new THREE.Color("#0a1020"),
  ground: new THREE.Color("#171a21"),
  sun: new THREE.Color("#b9cbe8"),
  key: new THREE.Color("#a8bfe6"),
  keyIntensity: 1.5,
  // Night still has to read as a *forest*, not a black screen: moonlight in
  // the open is far brighter than intuition suggests, and foliage lit only by
  // a weak key collapses to silhouette.
  ambient: new THREE.Color("#33415f"),
  ambientIntensity: 0.62,
  hemiSky: new THREE.Color("#3d4d70"),
  hemiGround: new THREE.Color("#24211d"),
  hemiIntensity: 0.75,
  fog: new THREE.Color("#1d2434"),
  sunElevation: -0.22,
};

/**
 * Fixed azimuths. Sun and moon sit opposite each other so one always frames the
 * scene.
 *
 * Swung a little toward the walk's own axis from the original -0.95, so a low
 * sun rakes across the avenue rather than straight along it: shadows fall
 * diagonally over the gravel instead of running away from the camera, and it
 * takes only a small pan off the resting view to put the sun in frame for the
 * god-ray pass.
 */
const SUN_AZIMUTH = -0.82;
const MOON_AZIMUTH = SUN_AZIMUTH + Math.PI;

/**
 * Deliberately shallow. The camera rests near-horizontal at a 52-degree FOV, so
 * a body near the zenith would sit above the frustum -- keeping the arc low is
 * what keeps the sun and moon actually visible in the default framing.
 */
const MOON_ELEVATION_NIGHT = 0.38;
const MOON_ELEVATION_DAY = -0.28;

const EASE_LAMBDA = 1.6;

/**
 * How long after mount the shadow map keeps redrawing every frame, covering the
 * trees' sprout-in (`introProgress`: 1.6s of stagger plus a 1.05s rise).
 *
 * Kept tight to that, not generous: this window is the most expensive the scene
 * ever gets -- every tree drawn twice, on the same frames as the texture uploads
 * and the first shader compiles -- and it is the first thing a visitor sees.
 */
const SHADOW_WARMUP_SECONDS = 3;
/**
 * Longest the shadow map is allowed to go without a redraw once it is frozen.
 *
 * Nothing in the scene *should* invalidate it -- the light only moves with the
 * day/night ease, and the shadow camera is pinned to the exhibit rather than to
 * the viewer -- but the foliage LOD is resolved per frame from camera distance,
 * so a long walk toward the far end of the valley can leave a canopy casting the
 * shadow it had when it was a hull. One redraw a second is a rounding error
 * against redrawing 850k triangles sixty times a second, and it self-heals.
 */
const SHADOW_REFRESH_SECONDS = 1;
/** Day-factor movement that counts as the sun actually travelling. */
const SHADOW_DAY_EPSILON = 0.0015;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDirection;
void main() {
  vDirection = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uGround;
uniform vec3 uSunColor;
uniform vec3 uSunDirection;
uniform float uStarStrength;
uniform float uTime;
varying vec3 vDirection;

// Cheap 3-D hash used only for the star field. A geometry-free star dome costs
// two instructions per pixel; a Points cloud would cost thousands of vertices
// and a sorting headache.
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 dir = normalize(vDirection);
  float h = dir.y;

  vec3 sky = mix(uHorizon, uZenith, pow(clamp(h, 0.0, 1.0), 0.55));
  // Below the horizon the dome fades to a dark ground haze, so the terrain's
  // silhouette never meets a bright band at its edge.
  sky = mix(uGround, sky, smoothstep(-0.14, 0.05, h));

  float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
  sky += uSunColor * pow(sunDot, 10.0) * 0.30;
  sky += uSunColor * pow(sunDot, 900.0) * 6.0;

  if (uStarStrength > 0.001) {
    vec3 cell = floor(dir * 340.0);
    float n = hash13(cell);
    float star = smoothstep(0.9977, 1.0, n);
    float twinkle = 0.7 + 0.3 * sin(uTime * 2.2 + n * 90.0);
    sky += vec3(star * twinkle) * uStarStrength * smoothstep(0.0, 0.3, h);
  }

  gl_FragColor = vec4(sky, 1.0);
}
`;

export interface AtmosphereProps {
  isDark: boolean;
  /** Scene centre in world XZ, so lights and shadows follow the exhibit. */
  center: [number, number];
  /** Base radius the sun/moon arc on. Scales with camera distance so they stay framed. */
  radius: number;
  fogNear: number;
  fogFar: number;
  shadowMapSize: number;
  shadowExtent: number;
  /** Live sky colors, mutated in place for Water and GroundFog to read. */
  skyState: SkyState;
  onSunCore?: (mesh: THREE.Mesh | null) => void;
  onMoonCore?: (mesh: THREE.Mesh | null) => void;
}

export default function Atmosphere({
  isDark,
  center,
  radius,
  fogNear,
  fogFar,
  shadowMapSize,
  shadowExtent,
  skyState,
  onSunCore,
  onMoonCore,
}: AtmosphereProps) {
  const reducedMotion = usePrefersReducedMotion();

  const domeRef = useRef<THREE.Mesh>(null);
  const fogRef = useRef<THREE.Fog>(null);
  const keyLightRef = useRef<THREE.DirectionalLight>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);
  const sunRef = useRef<THREE.Mesh>(null);
  const moonRef = useRef<THREE.Mesh>(null);

  const dayFactor = useRef(isDark ? 0 : 1);

  const skyUniforms = useMemo(
    () => ({
      // THREE.Uniform, not `{ value }` -- see `imperative.ts`.
      uHorizon: new THREE.Uniform(skyState.horizon.clone()),
      uZenith: new THREE.Uniform(skyState.zenith.clone()),
      uGround: new THREE.Uniform(new THREE.Color("#8d8163")),
      uSunColor: new THREE.Uniform(skyState.sunColor.clone()),
      uSunDirection: new THREE.Uniform(skyState.sunDirection.clone()),
      uStarStrength: new THREE.Uniform(isDark ? 1 : 0),
      uTime: new THREE.Uniform(0),
    }),
    // Seeded once; every value is driven imperatively from the frame loop after
    // that, via `setUniform` and three's own in-place methods.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Built here, not as a `<shaderMaterial uniforms={...}>` element: passing
  // uniforms through JSX does not guarantee the material ends up holding *this*
  // object, and a detached copy leaves the sky frozen at its seed values with
  // no error reported anywhere.
  const skyMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: skyUniforms,
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
      }),
    [skyUniforms],
  );

  useEffect(() => () => skyMaterial.dispose(), [skyMaterial]);

  useEffect(() => {
    onSunCore?.(sunRef.current);
    onMoonCore?.(moonRef.current);
    return () => {
      onSunCore?.(null);
      onMoonCore?.(null);
    };
  }, [onSunCore, onMoonCore]);

  const shadowAge = useRef(0);
  const shadowDayFactor = useRef(Number.NaN);
  const mountAge = useRef(0);

  useEffect(() => {
    const light = keyLightRef.current;
    if (!light) return;
    if (targetRef.current) light.target = targetRef.current;
    // The shadow map is re-rendered on demand, not every frame: it is the whole
    // forest drawn a second time, and the only thing that moves in it is the
    // wind sway. Measured at ~19ms a frame on integrated graphics -- a quarter
    // of the entire budget, spent on a sway nobody can see in a shadow.
    light.shadow.autoUpdate = false;
    light.shadow.needsUpdate = true;
  }, []);

  const scratch = useMemo(
    () => ({ direction: new THREE.Vector3(), position: new THREE.Vector3() }),
    [],
  );

  useFrame(({ camera, clock }, delta) => {
    const target = isDark ? 0 : 1;
    dayFactor.current = reducedMotion
      ? target
      : THREE.MathUtils.damp(dayFactor.current, target, EASE_LAMBDA, delta);
    const t = dayFactor.current;

    setUniform(skyUniforms.uTime, clock.elapsedTime);

    // --- sky gradient ------------------------------------------------------
    skyState.horizon.copy(NIGHT.horizon).lerp(DAY.horizon, t);
    skyState.zenith.copy(NIGHT.zenith).lerp(DAY.zenith, t);
    skyState.sunColor.copy(NIGHT.sun).lerp(DAY.sun, t);

    skyUniforms.uHorizon.value.copy(skyState.horizon);
    skyUniforms.uZenith.value.copy(skyState.zenith);
    skyUniforms.uGround.value.copy(NIGHT.ground).lerp(DAY.ground, t);
    setUniform(skyUniforms.uStarStrength, 1 - THREE.MathUtils.smoothstep(t, 0.15, 0.7));

    // --- celestial bodies --------------------------------------------------
    const sunElevation = THREE.MathUtils.lerp(NIGHT.sunElevation, DAY.sunElevation, t);
    const moonElevation = THREE.MathUtils.lerp(MOON_ELEVATION_NIGHT, MOON_ELEVATION_DAY, t);

    placeBody(scratch.direction, sunElevation, SUN_AZIMUTH);
    skyState.sunDirection.copy(scratch.direction);
    skyUniforms.uSunDirection.value.copy(scratch.direction);

    if (sunRef.current) {
      scratch.position.copy(scratch.direction).multiplyScalar(radius);
      sunRef.current.position.set(
        center[0] + scratch.position.x,
        scratch.position.y,
        center[1] + scratch.position.z,
      );
      fadeBody(sunRef.current, sunElevation);
    }

    if (moonRef.current) {
      placeBody(scratch.direction, moonElevation, MOON_AZIMUTH);
      scratch.position.copy(scratch.direction).multiplyScalar(radius);
      moonRef.current.position.set(
        center[0] + scratch.position.x,
        scratch.position.y,
        center[1] + scratch.position.z,
      );
      fadeBody(moonRef.current, moonElevation);
    }

    // --- lights ------------------------------------------------------------
    const key = keyLightRef.current;
    if (key) {
      key.color.copy(NIGHT.key).lerp(DAY.key, t);
      key.intensity = THREE.MathUtils.lerp(NIGHT.keyIntensity, DAY.keyIntensity, t);
      // The key light follows whichever body is up: sun by day, moon at night.
      const lightElevation = t > 0.5 ? sunElevation : moonElevation;
      const lightAzimuth = t > 0.5 ? SUN_AZIMUTH : MOON_AZIMUTH;
      placeBody(scratch.direction, Math.max(lightElevation, 0.12), lightAzimuth);
      key.position.set(
        center[0] + scratch.direction.x * 70,
        scratch.direction.y * 70,
        center[1] + scratch.direction.z * 70,
      );

      mountAge.current += delta;
      shadowAge.current += delta;
      const sunMoved = Math.abs(t - shadowDayFactor.current) > SHADOW_DAY_EPSILON;
      if (
        sunMoved ||
        mountAge.current < SHADOW_WARMUP_SECONDS ||
        shadowAge.current > SHADOW_REFRESH_SECONDS
      ) {
        key.shadow.needsUpdate = true;
        shadowDayFactor.current = t;
        shadowAge.current = 0;
      }
    }

    const ambient = ambientRef.current;
    if (ambient) {
      ambient.color.copy(NIGHT.ambient).lerp(DAY.ambient, t);
      ambient.intensity = THREE.MathUtils.lerp(NIGHT.ambientIntensity, DAY.ambientIntensity, t);
    }

    const hemi = hemiRef.current;
    if (hemi) {
      hemi.color.copy(NIGHT.hemiSky).lerp(DAY.hemiSky, t);
      hemi.groundColor.copy(NIGHT.hemiGround).lerp(DAY.hemiGround, t);
      hemi.intensity = THREE.MathUtils.lerp(NIGHT.hemiIntensity, DAY.hemiIntensity, t);
    }

    if (fogRef.current) {
      fogRef.current.color.copy(NIGHT.fog).lerp(DAY.fog, t);
    }

    // Dome rides the camera so it can never be clipped or escaped.
    domeRef.current?.position.copy(camera.position);
  });

  return (
    <>
      <fog ref={fogRef} attach="fog" args={[isDark ? "#1d2434" : "#d5c6ab", fogNear, fogFar]} />

      <mesh ref={domeRef} renderOrder={-1000} material={skyMaterial}>
        <sphereGeometry args={[1, 32, 20]} />
      </mesh>

      <ambientLight ref={ambientRef} intensity={DAY.ambientIntensity} />
      <hemisphereLight ref={hemiRef} intensity={DAY.hemiIntensity} />

      <object3D ref={targetRef} position={[center[0], 0, center[1]]} />
      <directionalLight
        ref={keyLightRef}
        castShadow
        intensity={DAY.keyIntensity}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-bias={-0.0006}
        shadow-normalBias={0.035}
      />

      {/* Unlit discs, exempt from fog and tone mapping, so they always read as
          light sources rather than shaded spheres or fogged smudges. Their
          large radius can ignore fogFar precisely because fog is off. */}
      <mesh ref={sunRef} renderOrder={-900}>
        <sphereGeometry args={[radius * 0.055, 24, 16]} />
        <meshBasicMaterial color="#fff5dc" fog={false} toneMapped={false} transparent />
      </mesh>
      <mesh ref={moonRef} renderOrder={-900}>
        <sphereGeometry args={[radius * 0.04, 24, 16]} />
        <meshBasicMaterial color="#dfe7f5" fog={false} toneMapped={false} transparent />
      </mesh>
    </>
  );
}

/** Unit direction for an elevation/azimuth pair. */
function placeBody(out: THREE.Vector3, elevation: number, azimuth: number): THREE.Vector3 {
  const cos = Math.cos(elevation);
  return out.set(cos * Math.sin(azimuth), Math.sin(elevation), cos * Math.cos(azimuth)).normalize();
}

/** Fade a body out as it dips below the horizon, rather than letting it clip through the ground. */
function fadeBody(mesh: THREE.Mesh, elevation: number): void {
  const opacity = THREE.MathUtils.smoothstep(elevation, -0.16, 0.05);
  const material = mesh.material as THREE.MeshBasicMaterial;
  material.opacity = opacity;
  mesh.visible = opacity > 0.01;
}
