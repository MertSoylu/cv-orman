"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

/** World-space focus point for the currently selected tree, or null when nothing is selected. */
export interface SelectionFocusPoint {
  position: [number, number, number];
  /** The tree's final world scale (growthToScale * jitter) -- sizes the ground halo to the canopy. */
  scale: number;
}

// --- Spotlight -------------------------------------------------------------

const SPOT_HEIGHT = 11;
const SPOT_FORWARD = 2.5;
// Physically-correct lights (three r155+ default): intensity is candela, and
// decay-attenuated over ~11 units of throw -- hence the triple-digit ceiling.
const SPOT_MAX_INTENSITY = 260;
const SPOT_DECAY = 1.6;
const RING_MAX_OPACITY = 0.8;
// Fade lambda for both the light and the halo -- quick enough to feel like a
// stage light snapping on, slow enough not to strobe when hopping trees.
const FADE_DAMP_LAMBDA = 5;

export interface SelectionSpotlightProps {
  focus: SelectionFocusPoint | null;
}

/**
 * Stage-light treatment for the selected tree: a warm spotlight from above
 * plus a glowing ground halo around the trunk. Stays mounted with intensity
 * damped toward 0 when nothing is selected, so selecting/deselecting fades
 * rather than mounting/unmounting a light (which would recompile shaders).
 */
export function SelectionSpotlight({ focus }: SelectionSpotlightProps) {
  const lightRef = useRef<THREE.SpotLight>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  // Stable scene object the spotlight aims at -- memo, not a ref, so render
  // can pass it as JSX props without tripping react-hooks/refs.
  const spotTarget = useMemo(() => new THREE.Object3D(), []);
  const fade = useRef(0);
  // Last known focus, kept while fading out so the light dims in place
  // instead of jumping to origin the frame the selection clears.
  const lastFocus = useRef<SelectionFocusPoint | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useFrame(({ clock }, delta) => {
    if (focus) lastFocus.current = focus;
    const light = lightRef.current;
    const ring = ringRef.current;
    const ringMaterial = ringMaterialRef.current;
    const anchor = lastFocus.current;
    if (!light || !ring || !ringMaterial || !anchor) return;

    const target = focus ? 1 : 0;
    fade.current = reducedMotion ? target : THREE.MathUtils.damp(fade.current, target, FADE_DAMP_LAMBDA, delta);

    const [x, , z] = anchor.position;
    light.position.set(x, SPOT_HEIGHT, z + SPOT_FORWARD);
    spotTarget.position.set(x, 1.2, z);
    spotTarget.updateMatrixWorld();
    light.intensity = fade.current * SPOT_MAX_INTENSITY;

    const ringRadius = 1.0 * anchor.scale;
    // Gentle breathing pulse on the halo -- static ring under reduced motion.
    const pulse = reducedMotion ? 1 : 1 + Math.sin(clock.elapsedTime * 2.2) * 0.05;
    ring.position.set(x, 0.03, z);
    ring.scale.setScalar(ringRadius * pulse);
    ringMaterial.opacity = fade.current * RING_MAX_OPACITY;
    ring.visible = fade.current > 0.01;
  });

  return (
    <>
      <primitive object={spotTarget} />
      <spotLight
        ref={lightRef}
        color="#ffe3b8"
        intensity={0}
        angle={0.42}
        penumbra={0.65}
        distance={40}
        decay={SPOT_DECAY}
        target={spotTarget}
      />
      {/* Unit-radius halo, scaled per-frame to the selected tree's size.
          toneMapped=false keeps it bright enough to catch the bloom pass. */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
        <ringGeometry args={[0.82, 1, 48]} />
        <meshBasicMaterial
          ref={ringMaterialRef}
          color="#ffd27a"
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>
    </>
  );
}

// --- Camera rig ------------------------------------------------------------

// How far from the tree the camera settles -- close enough to fill the frame
// with one tree, far enough to keep the signpost and neighbors in view.
const FOCUS_DISTANCE = 11;
const FOCUS_TARGET_HEIGHT = 2.4;
// Minimum elevation of the approach path, as a fraction of FOCUS_DISTANCE.
// Kept high so the vantage looks DOWN onto the selected tree and clears the
// front-row canopies -- a low approach flew the camera into a foreground
// tree's foliage, filling the frame with its lit underside.
const FOCUS_MIN_ELEVATION = 0.62;
const FLY_DAMP_LAMBDA = 2.2;
// Squared world-unit distance at which the flight counts as arrived and
// releases the camera back to the user.
const ARRIVE_EPSILON_SQ = 0.01;

export interface CameraRigProps {
  focus: SelectionFocusPoint | null;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}

/**
 * Cinematic approach on selection: eases the OrbitControls target onto the
 * selected tree and flies the camera in along its current view direction to
 * a close vantage. The flight is interruptible -- any user interaction with
 * the controls ("start" event) cancels it immediately, and once arrived the
 * camera is fully back under user control. Deselecting moves nothing (the
 * user keeps whatever framing they had). Reduced motion snaps instead.
 */
export function CameraRig({ focus, controlsRef }: CameraRigProps) {
  const { camera } = useThree();
  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!focus) {
      goal.current = null;
      return;
    }
    const [x, , z] = focus.position;
    const target = new THREE.Vector3(x, FOCUS_TARGET_HEIGHT, z);
    // Approach along the current view direction so the fly-in never swings
    // the camera around the scene, only toward the tree.
    const approach = camera.position.clone().sub(target);
    approach.y = Math.max(approach.y, 0);
    if (approach.lengthSq() < 1e-6) approach.set(0, 0.5, 1);
    approach.normalize().multiplyScalar(FOCUS_DISTANCE);
    approach.y = Math.max(approach.y, FOCUS_DISTANCE * FOCUS_MIN_ELEVATION);
    goal.current = { target, position: target.clone().add(approach) };
  }, [focus, camera]);

  // User grabbing the controls mid-flight cancels the flight -- "start" only
  // fires on real pointer/wheel interaction, not on programmatic updates.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cancel = () => {
      goal.current = null;
    };
    controls.addEventListener("start", cancel);
    return () => controls.removeEventListener("start", cancel);
  }, [controlsRef, focus]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    const active = goal.current;
    if (!controls || !active) return;

    if (reducedMotion) {
      camera.position.copy(active.position);
      controls.target.copy(active.target);
      controls.update();
      goal.current = null;
      return;
    }

    dampVector(camera.position, active.position, FLY_DAMP_LAMBDA, delta);
    dampVector(controls.target, active.target, FLY_DAMP_LAMBDA, delta);
    controls.update();

    if (
      camera.position.distanceToSquared(active.position) < ARRIVE_EPSILON_SQ &&
      controls.target.distanceToSquared(active.target) < ARRIVE_EPSILON_SQ
    ) {
      goal.current = null;
    }
  });

  return null;
}

// --- Guard rails -----------------------------------------------------------

export interface CameraBoundsInfo {
  /** Ground center in world (x, z). */
  center: [number, number];
  /** Half-extent the target may pan from center, per axis (already includes margin). */
  halfX: number;
  halfZ: number;
  /** Camera eye never dips below this Y (no diving under the terrain). */
  minY: number;
}

export interface CameraBoundsProps {
  bounds: CameraBoundsInfo;
  controlsRef: RefObject<OrbitControlsImpl | null>;
}

/**
 * Always-on guard rails, independent of selection or fly-in: every frame it
 * clamps the OrbitControls target inside the exhibit footprint (pan can't
 * wander off into empty space) and lifts the camera back above the ground if
 * anything ever pushed it under. Runs after OrbitControls' own update via a
 * late useFrame render priority so its clamp wins.
 */
export function CameraBounds({ bounds, controlsRef }: CameraBoundsProps) {
  const { camera } = useThree();
  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const [cx, cz] = bounds.center;
    const target = controls.target;
    const clampedX = THREE.MathUtils.clamp(target.x, cx - bounds.halfX, cx + bounds.halfX);
    const clampedZ = THREE.MathUtils.clamp(target.z, cz - bounds.halfZ, cz + bounds.halfZ);
    if (clampedX !== target.x || clampedZ !== target.z) {
      target.set(clampedX, target.y, clampedZ);
    }
    if (camera.position.y < bounds.minY) {
      camera.position.setY(bounds.minY);
    }
  }, 1);
  return null;
}

function dampVector(current: THREE.Vector3, target: THREE.Vector3, lambda: number, delta: number) {
  current.x = THREE.MathUtils.damp(current.x, target.x, lambda, delta);
  current.y = THREE.MathUtils.damp(current.y, target.y, lambda, delta);
  current.z = THREE.MathUtils.damp(current.z, target.z, lambda, delta);
}
