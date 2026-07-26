"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { terrainHeight } from "./terrain/heightfield";

/**
 * Camera behaviour on top of OrbitControls: the selection fly-in, and the guard
 * rails that stop it putting the viewer underground or outside the exhibit.
 * They live together because they are one state machine -- selection owns the
 * camera until it arrives or the user grabs the controls.
 *
 * There is no opening move. It was a three-and-a-half second drift from a wide
 * shot down to the trail head, and it cost more than it bought: on a page whose
 * whole proposition is "walk into the wood", the first thing a visitor met was
 * an animation they had to wait out or interrupt. The resting framing
 * `Forest3D` hands in is where that move used to end -- square in front of the
 * near gate, looking down the walk.
 */

const FLY_DAMP_LAMBDA = 2.2;
const ARRIVE_EPSILON_SQ = 0.01;

/** Where the camera settles when a tree is selected. */
const FOCUS_DISTANCE = 10;
const FOCUS_TARGET_HEIGHT = 2.6;
const FOCUS_MIN_ELEVATION = 0.5;

export interface SelectionFocusPoint {
  position: [number, number, number];
  /** The tree's final world scale, so the halo and focus height match its size. */
  scale: number;
}

export interface CameraBoundsInfo {
  center: [number, number];
  halfX: number;
  halfZ: number;
  /** Camera eye never gets closer than this to the terrain surface. */
  minClearance: number;
}

export interface CameraRigProps {
  controlsRef: RefObject<OrbitControlsImpl | null>;
  /** Where the view starts: standing on the trail, looking down it. */
  restPosition: [number, number, number];
  restTarget: [number, number, number];
  focus: SelectionFocusPoint | null;
  bounds: CameraBoundsInfo;
}

export default function CameraRig({
  controlsRef,
  restPosition,
  restTarget,
  focus,
  bounds,
}: CameraRigProps) {
  const { camera } = useThree();
  const reducedMotion = usePrefersReducedMotion();

  const restTo = useMemo(() => new THREE.Vector3(...restPosition), [restPosition]);
  const restLookTo = useMemo(() => new THREE.Vector3(...restTarget), [restTarget]);

  const goal = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);

  // Seat the camera before the first painted frame, so there is never a frame
  // at the default camera position.
  useEffect(() => {
    const controls = controlsRef.current;
    camera.position.copy(restTo);
    controls?.target.copy(restLookTo);
    controls?.update();
    // Runs once: re-seating the camera whenever the forest re-renders would
    // yank the view out from under the user.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Any real interaction cancels the fly-in. The "start" event only fires on
  // pointer/wheel input, never on our own updates.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const cancel = () => {
      goal.current = null;
    };
    controls.addEventListener("start", cancel);
    return () => controls.removeEventListener("start", cancel);
  }, [controlsRef]);

  useEffect(() => {
    if (!focus) {
      goal.current = null;
      return;
    }

    const [x, , z] = focus.position;
    const target = new THREE.Vector3(x, FOCUS_TARGET_HEIGHT * focus.scale, z);
    // Approach along the current view direction, so the fly-in moves toward the
    // tree rather than swinging around the valley to a canned angle.
    const approach = camera.position.clone().sub(target);
    approach.y = Math.max(approach.y, 0);
    if (approach.lengthSq() < 1e-6) approach.set(0, 0.5, 1);
    approach.normalize().multiplyScalar(FOCUS_DISTANCE);
    approach.y = Math.max(approach.y, FOCUS_DISTANCE * FOCUS_MIN_ELEVATION);

    goal.current = { target, position: target.clone().add(approach) };
  }, [focus, camera]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    const active = goal.current;
    if (!active) return;

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

  // Late priority so this clamp runs after OrbitControls' own update and after
  // the moves above -- otherwise a fly-in could park the eye inside a hill for
  // a frame before being corrected.
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

    const floor = terrainHeight(camera.position.x, camera.position.z) + bounds.minClearance;
    if (camera.position.y < floor) camera.position.setY(floor);
  }, 1);

  return null;
}

function dampVector(current: THREE.Vector3, target: THREE.Vector3, lambda: number, delta: number) {
  current.x = THREE.MathUtils.damp(current.x, target.x, lambda, delta);
  current.y = THREE.MathUtils.damp(current.y, target.y, lambda, delta);
  current.z = THREE.MathUtils.damp(current.z, target.z, lambda, delta);
}
