"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { pathPointAt, pathTangentAt } from "@/lib/forest/path";
import { setEmissiveIntensity } from "../imperative";
import { PLANE_SCALE, terrainHeight } from "../terrain/heightfield";
import { inBridgeGap, trailHalfWidth, TRAIL_SURFACE_LIFT } from "../terrain/crossing";

const UP = new THREE.Vector3(0, 1, 0);

/**
 * The threshold at each end of the walk: a pair of stone piers with bronze caps
 * and a beacon on each, standing over a sill of slabs laid across the gravel.
 *
 * A trail that simply begins somewhere in the grass and ends somewhere in the
 * fog has no first or last moment, and an exhibit is nothing but a sequence of
 * moments in a chosen order. The gate supplies both ends of that sequence. It
 * also does the more immediate job of giving the opening frame something built
 * and symmetrical to sit behind -- the camera rests just short of the near gate,
 * so the visit starts by looking *through* something rather than at a hillside.
 *
 * Both gates are one set of four InstancedMeshes. Everything is static; only the
 * beacons animate, and they animate a shared material rather than per-instance
 * data, exactly as the trail lanterns do.
 */

/**
 * Tall enough that the gate still reads over the page's own overlay panels.
 * The scene is framed inside a page, not a viewport: the legend card takes the
 * bottom band of the canvas, so a gate the height of a person is one whose base
 * -- the half that tells you it is standing on the walk -- is behind a card.
 */
const PIER_HEIGHT = 2.9;
/** Circumradius of the square pier. Sides come out a little under 0.6 world units. */
const PIER_RADIUS_BASE = 0.42;
const PIER_RADIUS_TOP = 0.34;
/** Clear space between the gravel's edge and the pier's centre. */
const PIER_CLEAR = 0.72;
const CAP_SIZE = 0.64;
const CAP_THICKNESS = 0.12;
/** Slabs laid across the walk under the gate. Odd, so one sits on the centerline. */
const SILL_SLABS = 7;
const SILL_THICKNESS = 0.16;
/** How far the sill stands proud of the gravel. Enough to catch a raking sun, not enough to trip on. */
const SILL_PROUD = 0.045;

export interface GatewayProps {
  /** Forward distances along the trail at which a gate stands. */
  marks: number[];
  isDark: boolean;
}

interface Gate {
  /** Centerline point, on the terrain. */
  origin: THREE.Vector3;
  yaw: number;
  halfWidth: number;
}

function buildGates(marks: number[]): Gate[] {
  const gates: Gate[] = [];

  for (const s of marks) {
    const center = pathPointAt(s);
    const x = center.x / PLANE_SCALE;
    const z = center.y / PLANE_SCALE;
    // A gate standing in the creek would be a folly in the other sense.
    if (inBridgeGap(x, z)) continue;

    const tangent = pathTangentAt(s);
    gates.push({
      // Both piers share the centerline's height rather than each sampling the
      // ground under itself: a built structure has one datum, and a gate whose
      // two halves sit at different heights reads as broken rather than as
      // following the land.
      origin: new THREE.Vector3(x, terrainHeight(x, z), z),
      yaw: Math.atan2(tangent.x, tangent.y),
      halfWidth: trailHalfWidth(s),
    });
  }

  return gates;
}

export default function Gateway({ marks, isDark }: GatewayProps) {
  const pierRef = useRef<THREE.InstancedMesh>(null);
  const capRef = useRef<THREE.InstancedMesh>(null);
  const beaconRef = useRef<THREE.InstancedMesh>(null);
  const sillRef = useRef<THREE.InstancedMesh>(null);
  const glow = useRef(isDark ? 1 : 0);

  const gates = useMemo(() => buildGates(marks), [marks]);

  const beaconMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffe6bd",
        emissive: new THREE.Color("#ffbe68"),
        emissiveIntensity: 0.5,
        roughness: 0.3,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => () => beaconMaterial.dispose(), [beaconMaterial]);

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    const local = new THREE.Vector3();
    const world = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const unit = new THREE.Vector3(1, 1, 1);

    /** Place `local` (x across the walk, y up, z along it) into world space. */
    const place = (gate: Gate, across: number, up: number, along: number): THREE.Vector3 => {
      local.set(across, up, along);
      local.applyAxisAngle(UP, gate.yaw);
      return world.copy(gate.origin).add(local);
    };

    let pierIndex = 0;
    let sillIndex = 0;

    gates.forEach((gate) => {
      euler.set(0, gate.yaw, 0);
      quaternion.setFromEuler(euler);

      for (const side of [-1, 1]) {
        const across = side * (gate.halfWidth + PIER_CLEAR);

        // Sunk a little, so a pier never shows daylight under it where the
        // ground falls away from the centerline datum.
        place(gate, across, PIER_HEIGHT / 2 - 0.14, 0);
        // The four-sided cylinder's faces land on the diagonals; the extra
        // eighth-turn squares them to the walk.
        euler.set(0, gate.yaw + Math.PI / 4, 0);
        matrix.compose(world, quaternion.setFromEuler(euler), unit);
        pierRef.current?.setMatrixAt(pierIndex, matrix);

        euler.set(0, gate.yaw, 0);
        quaternion.setFromEuler(euler);
        place(gate, across, PIER_HEIGHT - 0.14 + CAP_THICKNESS / 2, 0);
        matrix.compose(world, quaternion, unit);
        capRef.current?.setMatrixAt(pierIndex, matrix);

        place(gate, across, PIER_HEIGHT - 0.14 + CAP_THICKNESS + 0.14, 0);
        matrix.compose(world, quaternion, unit);
        beaconRef.current?.setMatrixAt(pierIndex, matrix);

        pierIndex++;
      }

      // --- the sill --------------------------------------------------------
      const slabPitch = (gate.halfWidth * 2) / SILL_SLABS;
      for (let i = 0; i < SILL_SLABS; i++) {
        const across = (i - (SILL_SLABS - 1) / 2) * slabPitch;
        place(gate, across, TRAIL_SURFACE_LIFT + SILL_PROUD - SILL_THICKNESS / 2, 0);
        scale.set(slabPitch * 0.9, SILL_THICKNESS, 0.86);
        matrix.compose(world, quaternion, scale);
        sillRef.current?.setMatrixAt(sillIndex++, matrix);
      }
    });

    for (const mesh of [pierRef.current, capRef.current, beaconRef.current, sillRef.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.raycast = () => {};
    }
  }, [gates]);

  useFrame((_, delta) => {
    glow.current = THREE.MathUtils.damp(glow.current, isDark ? 1 : 0, 1.6, delta);
    setEmissiveIntensity(beaconMaterial, 0.5 + glow.current * 3.6);
  });

  if (gates.length === 0) return null;

  const pierCount = gates.length * 2;

  return (
    <group>
      <instancedMesh ref={pierRef} args={[undefined, undefined, pierCount]} castShadow receiveShadow>
        <cylinderGeometry args={[PIER_RADIUS_TOP, PIER_RADIUS_BASE, PIER_HEIGHT, 4]} />
        <meshStandardMaterial color="#b3ac9d" roughness={0.8} metalness={0} flatShading />
      </instancedMesh>

      {/* Bronze, matching the plaques rather than inventing a third metal: the
          cap and the placards are the same hand at work. */}
      <instancedMesh ref={capRef} args={[undefined, undefined, pierCount]} castShadow>
        <boxGeometry args={[CAP_SIZE, CAP_THICKNESS, CAP_SIZE]} />
        <meshStandardMaterial color="#8e7448" roughness={0.4} metalness={0.7} />
      </instancedMesh>

      <instancedMesh ref={beaconRef} args={[undefined, beaconMaterial, pierCount]}>
        <sphereGeometry args={[0.145, 12, 10]} />
      </instancedMesh>

      <instancedMesh
        ref={sillRef}
        args={[undefined, undefined, gates.length * SILL_SLABS]}
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#a7a192" roughness={0.86} metalness={0} />
      </instancedMesh>
    </group>
  );
}
