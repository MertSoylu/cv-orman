"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { pathNormalAt, pathPointAt, pathTangentAt } from "@/lib/forest/path";
import { seededRandom } from "../utils";
import { PLANE_SCALE, terrainHeight } from "./heightfield";
import { inBridgeGap, trailHalfWidth } from "./crossing";

/**
 * Dressed stone edging along both sides of the gravel.
 *
 * This is the cheapest and by some distance the loudest signal that the walk
 * was *made* rather than worn. A gravel ribbon laid straight onto turf reads as
 * a desire path -- fine for a wood, wrong for an exhibit -- and no amount of
 * work on the trees fixes that, because the eye settles the question at the
 * ground plane before it ever looks up. One run of kerbstones settles it the
 * other way.
 *
 * Blocks are laid end to end along the centerline, each seated on the terrain
 * and squared to the local tangent, so the run bends with the trail. Every
 * block carries a small seeded variation in length, height and yaw: a kerb of
 * identical blocks reads as an extruded ribbon, and the whole point is that it
 * should read as individually laid stone.
 *
 * One InstancedMesh for the entire walk. The run is split at the stream exactly
 * as the gravel is -- the bridge has its own rails, and a kerb marching into
 * the water would undo everything above.
 */

/** Plane units per block. Roughly a stride, so the joints read at walking pace. */
const KERB_PITCH = 19;
/**
 * Half-thickness of a block across the walk.
 *
 * Kept slim on purpose. The kerb's job is to draw a *line*, and a block heavy
 * enough to read as an object in its own right stops drawing one -- at trail
 * level a thick run looks like paving slabs dropped in the grass rather than an
 * edge. Thin and low, repeated often, reads as one continuous edge at every
 * distance the camera can get to.
 */
const KERB_HALF_WIDTH = 0.14;
/**
 * How far past the gravel's edge the kerb's outer face sits.
 *
 * Exported because the kerb is the walk's visible edge, so it is what the rest
 * of the exhibit sets itself out from: the plaques stand just clear of it and
 * the specimens' stepping stones start at it. Anything that measured off
 * `TRAIL_WIDTH` instead would sit a kerb's thickness too close and read as
 * crowding the path.
 */
export const KERB_CLEARANCE = KERB_HALF_WIDTH * 2;
const KERB_HEIGHT = 0.24;
/** How much of the block's height is buried, as a fraction. Laid stone sits *in* the ground. */
const KERB_BURIAL = 0.52;

export interface KerbProps {
  sStart: number;
  sEnd: number;
}

interface KerbStone {
  position: THREE.Vector3;
  yaw: number;
  scale: THREE.Vector3;
}

function buildKerb(sStart: number, sEnd: number): KerbStone[] {
  const rand = seededRandom("trail-kerb");
  const stones: KerbStone[] = [];

  for (let s = sStart; s <= sEnd; s += KERB_PITCH) {
    const center = pathPointAt(s);
    const normal = pathNormalAt(s);
    const tangent = pathTangentAt(s);
    const offset = trailHalfWidth(s) + KERB_HALF_WIDTH;

    for (const side of [-1, 1]) {
      // Drawn per candidate rather than per accepted stone, so a block skipped
      // at the stream doesn't shift every later block's variation.
      const lengthJitter = 0.9 + rand() * 0.16;
      const heightJitter = 0.86 + rand() * 0.28;
      const yawJitter = (rand() - 0.5) * 0.07;

      const x = center.x / PLANE_SCALE + normal.x * offset * side;
      const z = center.y / PLANE_SCALE + normal.y * offset * side;
      if (inBridgeGap(x, z)) continue;

      const height = KERB_HEIGHT * heightJitter;
      stones.push({
        position: new THREE.Vector3(x, terrainHeight(x, z) + height * (0.5 - KERB_BURIAL), z),
        yaw: Math.atan2(tangent.x, tangent.y) + yawJitter,
        scale: new THREE.Vector3(
          KERB_HALF_WIDTH * 2,
          height,
          ((KERB_PITCH / PLANE_SCALE) * lengthJitter),
        ),
      });
    }
  }

  return stones;
}

export default function Kerb({ sStart, sEnd }: KerbProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const stones = useMemo(() => buildKerb(sStart, sEnd), [sStart, sEnd]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();

    stones.forEach((stone, index) => {
      euler.set(0, stone.yaw, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(stone.position, quaternion, stone.scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Pointer events in the forest belong to the trees and the plaques. A kerb
    // that swallowed clicks would put a dead strip right along the walk, which
    // is exactly where the pointer spends its time.
    mesh.raycast = () => {};
  }, [stones]);

  if (stones.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, stones.length]} castShadow receiveShadow>
      <boxGeometry args={[1, 1, 1]} />
      {/* Pale dressed limestone: light enough to hold the walk's line against
          the turf at dusk, dull enough not to compete with the plaques' brass. */}
      <meshStandardMaterial color="#a29a89" roughness={0.85} metalness={0} />
    </instancedMesh>
  );
}
