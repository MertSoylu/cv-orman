"use client";

import { type ComponentRef, useMemo, useRef } from "react";
import * as THREE from "three";
import { Sky } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

// Sky/fog/light values for each of the site's two themes. Instead of being
// picked instantly by `isDark` (a hard snap on every toggle), both presets are
// kept live and every value is interpolated between them each frame by a
// damped `dayFactor` (1 = full day, 0 = full night) -- so flipping the theme
// drives a real, continuous lighting change: the sun sets, the moon rises, the
// sky reddens, the key light warms and dims, all in lockstep.
interface LightingPreset {
  skySunPosition: [number, number, number];
  skyTurbidity: number;
  skyRayleigh: number;
  skyMieCoefficient: number;
  skyMieDirectionalG: number;
  fogColor: string;
  ambientColor: string;
  ambientIntensity: number;
  hemisphereSky: string;
  hemisphereGround: string;
  hemisphereIntensity: number;
  directionalColor: string;
  directionalIntensity: number;
  directionalPosition: [number, number, number];
}

// Warm sunset/dusk read -- the site's dark-mode default, and the mood
// fireflies are gated to (see ExhibitEnvironment's showFireflies prop).
const NIGHT_PRESET: LightingPreset = {
  skySunPosition: [30, 5.5, -70],
  skyTurbidity: 12,
  skyRayleigh: 3.8,
  skyMieCoefficient: 0.032,
  skyMieDirectionalG: 0.92,
  fogColor: "#e8956b",
  ambientColor: "#ffdcb0",
  ambientIntensity: 0.42,
  hemisphereSky: "#ffd9a0",
  hemisphereGround: "#4a5530",
  hemisphereIntensity: 0.4,
  directionalColor: "#ffb066",
  directionalIntensity: 1.7,
  directionalPosition: [16, 18, -26],
};

// Clear midday read for light mode -- higher sun, lower turbidity/rayleigh
// for a pale blue sky instead of amber haze, cooler light colors.
const DAY_PRESET: LightingPreset = {
  skySunPosition: [40, 45, -30],
  skyTurbidity: 4,
  skyRayleigh: 1.2,
  skyMieCoefficient: 0.008,
  skyMieDirectionalG: 0.8,
  fogColor: "#dbe6ea",
  ambientColor: "#fff6e8",
  ambientIntensity: 0.55,
  hemisphereSky: "#bfe3ff",
  hemisphereGround: "#5c6b3a",
  hemisphereIntensity: 0.5,
  directionalColor: "#fff2d8",
  directionalIntensity: 1.9,
  directionalPosition: [20, 32, -20],
};

// Exponential-damping rate for the day<->night transition (frame-rate
// independent, same tool as Tree3D's hover ease). ~1.4s to settle -- long
// enough to read as the sun setting / moon rising, short enough not to feel
// sluggish after a toggle.
const DAY_DAMP_LAMBDA = 1.9;

// Celestial arc: a body's elevation angle sweeps from just under the horizon
// (hidden, faded out) up to a modest peak as its factor goes 0 -> 1. Sun and
// moon ride opposite azimuths so they cross the sky from opposite sides.
// PHI_MAX is deliberately low (~29deg): the camera rests near-horizontal with a
// 55deg FOV (~27deg half), so a zenith-high body would sit above the frustum and
// only show after orbiting up. This keeps sun/moon framed at rest.
const PHI_MIN = -0.22; // radians below horizon at factor 0 (set / not-yet-risen)
const PHI_MAX = 0.5; // ~29deg elevation at factor 1
const SUN_AZIMUTH_DEG = 32; // measured off the -Z (into-scene) axis, toward +X
const MOON_AZIMUTH_DEG = -38; // opposite side of the sky
// Sky radius as a multiple of the camera distance -- both scale with repo count
// together, so the body's apparent elevation from the camera stays constant.
const SKY_RADIUS_FACTOR = 6.5;

// Pre-parsed preset colors -- read-only sources we `.copy(...).lerp(...)` from
// each frame. Never mutated (lerp mutates the receiver, i.e. the light's own
// color, not these), so module-level singletons are safe.
const C_FOG_NIGHT = new THREE.Color(NIGHT_PRESET.fogColor);
const C_FOG_DAY = new THREE.Color(DAY_PRESET.fogColor);
const C_AMB_NIGHT = new THREE.Color(NIGHT_PRESET.ambientColor);
const C_AMB_DAY = new THREE.Color(DAY_PRESET.ambientColor);
const C_HEMI_SKY_NIGHT = new THREE.Color(NIGHT_PRESET.hemisphereSky);
const C_HEMI_SKY_DAY = new THREE.Color(DAY_PRESET.hemisphereSky);
const C_HEMI_GND_NIGHT = new THREE.Color(NIGHT_PRESET.hemisphereGround);
const C_HEMI_GND_DAY = new THREE.Color(DAY_PRESET.hemisphereGround);
const C_DIR_NIGHT = new THREE.Color(NIGHT_PRESET.directionalColor);
const C_DIR_DAY = new THREE.Color(DAY_PRESET.directionalColor);

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Places a sun/moon group on its arc for the given elevation factor (0..1). */
function placeBody(group: THREE.Group, factor: number, azimuthDeg: number, center: [number, number], radius: number) {
  const phi = lerp(PHI_MIN, PHI_MAX, factor);
  const horiz = Math.cos(phi) * radius;
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  group.position.set(
    center[0] + Math.sin(az) * horiz,
    Math.sin(phi) * radius, // dips below y=0 (and gets faded) near the horizon
    center[1] - Math.cos(az) * horiz // -Z: into the scene, where the camera looks
  );
}

/** Fades a body in/out by scaling every child material's baked base opacity. */
function fadeBody(group: THREE.Group, vis: number) {
  group.visible = vis > 0.001;
  if (!group.visible) return;
  group.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      const base = o.userData.baseOpacity as number | undefined;
      const mat = o.material as THREE.Material & { opacity: number };
      if (base !== undefined) mat.opacity = base * vis;
    }
  });
}

export interface CelestialSystemProps {
  /** Follows the site's dark-mode toggle -- the transition target, not an instant switch. */
  isDark: boolean;
  groundCenter: [number, number];
  /** Camera distance from the exhibit center -- sun/moon radius scales off this. */
  cameraDistance: number;
  /** Far distance for the scene fog, computed by Forest3D from the tree spread. */
  fogFar: number;
  /** Shadow map resolution edge length (square). Lowered on low-end devices. */
  shadowMapSize?: number;
}

/**
 * Owns the whole sky: the atmospheric Sky dome, scene fog, the three scene
 * lights (ambient/hemisphere/directional), and a visible sun + moon that arc
 * across the sky. A single useFrame eases a `dayFactor` toward the current
 * theme and drives every value off it imperatively (refs, not React props) so
 * the day<->night change is a continuous animation rather than a snap. The sun
 * rides the sky in light mode; toggling to dark sets it and rises the moon in
 * its place, with every real light interpolating alongside.
 */
export default function CelestialSystem({ isDark, groundCenter, cameraDistance, fogFar, shadowMapSize = 2048 }: CelestialSystemProps) {
  const reducedMotion = usePrefersReducedMotion();
  const scene = useThree((s) => s.scene);

  const skyRef = useRef<ComponentRef<typeof Sky>>(null);
  const ambientRef = useRef<THREE.AmbientLight>(null);
  const hemiRef = useRef<THREE.HemisphereLight>(null);
  const dirRef = useRef<THREE.DirectionalLight>(null);
  const sunRef = useRef<THREE.Group>(null);
  const moonRef = useRef<THREE.Group>(null);

  // Starts already at the correct end state so the very first frame after mount
  // is right -- no day->night flash on a dark-default load.
  const dayFactor = useRef(isDark ? 0 : 1);

  // Sun/moon sit well out in the sky at a radius that scales with the camera
  // distance (so apparent size/elevation hold across repo counts), clamped
  // under the camera's far plane (400). Their materials disable fog, so radius
  // vs fogFar is a non-issue (a body arcing low would otherwise fog to a blob).
  const radius = useMemo(
    () => THREE.MathUtils.clamp(cameraDistance * SKY_RADIUS_FACTOR, 68, 320),
    [cameraDistance]
  );
  const sunCoreR = useMemo(() => THREE.MathUtils.clamp(radius * 0.05, 3, 9), [radius]);
  const moonCoreR = sunCoreR * 0.82;

  useFrame((_, delta) => {
    const target = isDark ? 0 : 1;
    dayFactor.current = reducedMotion
      ? target
      : THREE.MathUtils.damp(dayFactor.current, target, DAY_DAMP_LAMBDA, delta);
    const f = dayFactor.current;

    // --- Sky dome: interpolate atmosphere + sun direction ---
    const mat = skyRef.current?.material;
    if (mat?.uniforms) {
      mat.uniforms.turbidity.value = lerp(NIGHT_PRESET.skyTurbidity, DAY_PRESET.skyTurbidity, f);
      mat.uniforms.rayleigh.value = lerp(NIGHT_PRESET.skyRayleigh, DAY_PRESET.skyRayleigh, f);
      mat.uniforms.mieCoefficient.value = lerp(NIGHT_PRESET.skyMieCoefficient, DAY_PRESET.skyMieCoefficient, f);
      mat.uniforms.mieDirectionalG.value = lerp(NIGHT_PRESET.skyMieDirectionalG, DAY_PRESET.skyMieDirectionalG, f);
      const sp = mat.uniforms.sunPosition.value as THREE.Vector3;
      sp.set(
        lerp(NIGHT_PRESET.skySunPosition[0], DAY_PRESET.skySunPosition[0], f),
        lerp(NIGHT_PRESET.skySunPosition[1], DAY_PRESET.skySunPosition[1], f),
        lerp(NIGHT_PRESET.skySunPosition[2], DAY_PRESET.skySunPosition[2], f)
      );
    }

    // --- Fog color ---
    const fog = scene.fog as THREE.Fog | null;
    if (fog) fog.color.copy(C_FOG_NIGHT).lerp(C_FOG_DAY, f);

    // --- Ambient ---
    if (ambientRef.current) {
      ambientRef.current.intensity = lerp(NIGHT_PRESET.ambientIntensity, DAY_PRESET.ambientIntensity, f);
      ambientRef.current.color.copy(C_AMB_NIGHT).lerp(C_AMB_DAY, f);
    }

    // --- Hemisphere (sky tint above / ground bounce below) ---
    if (hemiRef.current) {
      hemiRef.current.intensity = lerp(NIGHT_PRESET.hemisphereIntensity, DAY_PRESET.hemisphereIntensity, f);
      hemiRef.current.color.copy(C_HEMI_SKY_NIGHT).lerp(C_HEMI_SKY_DAY, f);
      hemiRef.current.groundColor.copy(C_HEMI_GND_NIGHT).lerp(C_HEMI_GND_DAY, f);
    }

    // --- Directional key light: warms + dims + drops toward the horizon at night ---
    if (dirRef.current) {
      dirRef.current.intensity = lerp(NIGHT_PRESET.directionalIntensity, DAY_PRESET.directionalIntensity, f);
      dirRef.current.color.copy(C_DIR_NIGHT).lerp(C_DIR_DAY, f);
      dirRef.current.position.set(
        lerp(NIGHT_PRESET.directionalPosition[0], DAY_PRESET.directionalPosition[0], f),
        lerp(NIGHT_PRESET.directionalPosition[1], DAY_PRESET.directionalPosition[1], f),
        lerp(NIGHT_PRESET.directionalPosition[2], DAY_PRESET.directionalPosition[2], f)
      );
    }

    // --- Sun rides `f`, moon rides `1 - f`: opposite arcs, opposite fades ---
    if (sunRef.current) {
      placeBody(sunRef.current, f, SUN_AZIMUTH_DEG, groundCenter, radius);
      fadeBody(sunRef.current, THREE.MathUtils.smoothstep(f, 0.02, 0.4));
    }
    if (moonRef.current) {
      placeBody(moonRef.current, 1 - f, MOON_AZIMUTH_DEG, groundCenter, radius);
      fadeBody(moonRef.current, THREE.MathUtils.smoothstep(1 - f, 0.02, 0.4));
    }
  });

  const initial = isDark ? NIGHT_PRESET : DAY_PRESET;

  return (
    <>
      {/* Sky/light values below are mount-time seeds only -- the useFrame above
          overwrites all of them (imperatively, via the refs) before every
          painted frame, which is what makes the theme change animate instead
          of snap. */}
      <Sky
        ref={skyRef}
        sunPosition={initial.skySunPosition}
        turbidity={initial.skyTurbidity}
        rayleigh={initial.skyRayleigh}
        mieCoefficient={initial.skyMieCoefficient}
        mieDirectionalG={initial.skyMieDirectionalG}
      />
      <fog attach="fog" args={[initial.fogColor, 18, fogFar]} />

      <ambientLight ref={ambientRef} intensity={initial.ambientIntensity} color={initial.ambientColor} />
      <hemisphereLight
        ref={hemiRef}
        args={[initial.hemisphereSky, initial.hemisphereGround, initial.hemisphereIntensity]}
      />
      <directionalLight
        ref={dirRef}
        position={initial.directionalPosition}
        intensity={initial.directionalIntensity}
        color={initial.directionalColor}
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-bias={-0.0004}
      />

      {/* Sun: warm core + two additive coronas. Unlit (meshBasicMaterial) and
          fog-exempt so it always reads as a bright disc, never a shaded ball or
          a fogged smudge. `baseOpacity` is what fadeBody scales during a
          transition. */}
      <group ref={sunRef}>
        <mesh userData={{ baseOpacity: 1 }}>
          <sphereGeometry args={[sunCoreR, 32, 24]} />
          <meshBasicMaterial color="#fff4c0" toneMapped={false} fog={false} transparent />
        </mesh>
        <mesh userData={{ baseOpacity: 0.32 }}>
          <sphereGeometry args={[sunCoreR * 1.9, 24, 18]} />
          <meshBasicMaterial
            color="#ffce78"
            toneMapped={false}
            fog={false}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh userData={{ baseOpacity: 0.16 }}>
          <sphereGeometry args={[sunCoreR * 3.2, 24, 18]} />
          <meshBasicMaterial
            color="#ff9d3c"
            toneMapped={false}
            fog={false}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>

      {/* Moon: cooler, tighter glow so it never competes with the sun for
          "brightest thing in the sky". */}
      <group ref={moonRef}>
        <mesh userData={{ baseOpacity: 1 }}>
          <sphereGeometry args={[moonCoreR, 32, 24]} />
          <meshBasicMaterial color="#eef1f8" toneMapped={false} fog={false} transparent />
        </mesh>
        <mesh userData={{ baseOpacity: 0.22 }}>
          <sphereGeometry args={[moonCoreR * 1.7, 24, 18]} />
          <meshBasicMaterial
            color="#cfd8ef"
            toneMapped={false}
            fog={false}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
        <mesh userData={{ baseOpacity: 0.1 }}>
          <sphereGeometry args={[moonCoreR * 2.6, 24, 18]} />
          <meshBasicMaterial
            color="#aebbe0"
            toneMapped={false}
            fog={false}
            transparent
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      </group>
    </>
  );
}
