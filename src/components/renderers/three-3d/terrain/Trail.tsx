"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { pathNormalAt, pathPointAt } from "@/lib/forest/path";
import { getBarkTextures, getGroundTextures } from "../textures";
import { PLANE_SCALE, terrainHeight, WATER_LEVEL } from "./heightfield";
import Kerb from "./Kerb";
import {
  archAt,
  bridgeFootprint,
  findStreamCrossing,
  DECK_BASE,
  DECK_THICKNESS,
  inBridgeGap,
  RAIL_HEIGHT,
  trailHalfWidth,
  TRAIL_SAMPLE_STEP,
  TRAIL_SURFACE_LIFT,
  type Crossing,
} from "./crossing";

/**
 * The gravel trail, and the bridge where it meets the stream.
 *
 * The ribbon is built by walking the same centerline the tree layout used and
 * laying a strip either side of it, dropped onto the terrain so it hugs the
 * relief instead of hovering. Where the stream crosses, the ribbon simply
 * stops: the run is split into two, and the bridge spans the gap. Letting a
 * gravel path dip through a watercourse would have been much less code and
 * looked exactly as wrong as it sounds.
 */

export interface TrailProps {
  /** Forward extent of the trail, in plane units. */
  sStart: number;
  sEnd: number;
}

export default function Trail({ sStart, sEnd }: TrailProps) {
  const geometry = useMemo(() => buildTrail(sStart, sEnd), [sStart, sEnd]);
  const crossing = useMemo(() => findStreamCrossing(sStart, sEnd), [sStart, sEnd]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const ground = useMemo(() => getGroundTextures(), []);

  return (
    <group>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial
          color="#cdb693"
          map={ground.map}
          normalMap={ground.normalMap}
          roughnessMap={ground.roughnessMap}
          normalScale={new THREE.Vector2(1.1, 1.1)}
          roughness={1}
          metalness={0}
        />
      </mesh>
      <Kerb sStart={sStart} sEnd={sEnd} />
      {crossing && <Bridge crossing={crossing} />}
    </group>
  );
}

// ---------------------------------------------------------------------------

function buildTrail(sStart: number, sEnd: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Vertex index of the first cross-section of the current unbroken run, or
  // null while inside the bridge gap.
  let runStartVertex: number | null = null;
  let previousVertex: number | null = null;
  let distanceAlong = 0;

  for (let s = sStart; s <= sEnd; s += TRAIL_SAMPLE_STEP) {
    const point = pathPointAt(s);
    const worldX = point.x / PLANE_SCALE;
    const worldZ = point.y / PLANE_SCALE;

    if (inBridgeGap(worldX, worldZ)) {
      runStartVertex = null;
      previousVertex = null;
      continue;
    }

    const normal = pathNormalAt(s);
    const width = trailHalfWidth(s);

    const leftX = worldX + normal.x * width;
    const leftZ = worldZ + normal.y * width;
    const rightX = worldX - normal.x * width;
    const rightZ = worldZ - normal.y * width;

    const base = positions.length / 3;
    positions.push(
      leftX,
      terrainHeight(leftX, leftZ) + TRAIL_SURFACE_LIFT,
      leftZ,
      rightX,
      terrainHeight(rightX, rightZ) + TRAIL_SURFACE_LIFT,
      rightZ,
    );

    distanceAlong += TRAIL_SAMPLE_STEP / PLANE_SCALE;
    uvs.push(0, distanceAlong / 3, 1, distanceAlong / 3);

    if (runStartVertex === null) {
      runStartVertex = base;
    } else if (previousVertex !== null) {
      indices.push(
        previousVertex,
        previousVertex + 1,
        base,
        previousVertex + 1,
        base + 1,
        base,
      );
    }
    previousVertex = base;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return geometry;
}

// ---------------------------------------------------------------------------

const PLANK_PITCH = 0.26;

/** Writes one box instance, positioned and rotated in the bridge's local frame. */
function writeBox(
  mesh: THREE.InstancedMesh | null,
  index: number,
  position: THREE.Vector3,
  euler: THREE.Euler,
  scale: THREE.Vector3,
): void {
  if (!mesh) return;
  const matrix = new THREE.Matrix4();
  matrix.compose(position, new THREE.Quaternion().setFromEuler(euler), scale);
  mesh.setMatrixAt(index, matrix);
}

/**
 * A plank footbridge over the narrows: cambered deck of individual boards on
 * two stringers, weathered handrails on turned posts, and four piles driven
 * into the bed.
 *
 * It is the one built object in the entire scene, so it carries the whole
 * scene's evidence of a human hand -- which is why the boards are separate
 * pieces with gaps between them rather than a single box: at trail level the
 * eye reads the board joints before it reads anything else about the structure.
 * The cost of that is five instanced meshes and a few hundred triangles, all
 * static.
 */
function Bridge({ crossing }: { crossing: Crossing }) {
  const wood = useMemo(() => getBarkTextures("fibrous"), []);

  const plankRef = useRef<THREE.InstancedMesh>(null);
  const stringerRef = useRef<THREE.InstancedMesh>(null);
  const railRef = useRef<THREE.InstancedMesh>(null);
  const postRef = useRef<THREE.InstancedMesh>(null);
  const pileRef = useRef<THREE.InstancedMesh>(null);

  const layout = useMemo(() => {
    const { length, width } = bridgeFootprint(crossing);
    const plankCount = Math.max(6, Math.round(length / PLANK_PITCH));
    // The arch is sampled, not analytic, for the long members: a straight
    // stringer under a cambered deck leaves daylight at the ends.
    const segments = 8;
    const postCount = 4;
    return { length, width, plankCount, segments, postCount, railOffset: width / 2 - 0.1 };
  }, [crossing]);

  useLayoutEffect(() => {
    const { length, width, plankCount, segments, postCount, railOffset } = layout;
    const position = new THREE.Vector3();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();

    // --- deck boards -------------------------------------------------------
    for (let i = 0; i < plankCount; i++) {
      const t = (i / (plankCount - 1)) * 2 - 1;
      const { y, pitch } = archAt(t);
      // Boards are laid slightly unevenly and each is a hair shorter than its
      // slot, so the gaps between them vary the way weathered decking does.
      const wobble = Math.sin(i * 2.4) * 0.012;
      position.set(0, DECK_BASE + y + wobble, (t * length) / 2);
      euler.set(-pitch, Math.sin(i * 1.7) * 0.012, 0);
      scale.set(width, DECK_THICKNESS, (length / plankCount) * 0.82);
      writeBox(plankRef.current, i, position, euler, scale);
    }

    // --- stringers under the deck -----------------------------------------
    let stringerIndex = 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < segments; i++) {
        const t = ((i + 0.5) / segments) * 2 - 1;
        const { y, pitch } = archAt(t);
        position.set(side * (width / 2 - 0.22), DECK_BASE + y - 0.12, (t * length) / 2);
        euler.set(-pitch, 0, 0);
        scale.set(0.13, 0.2, (length / segments) * 1.04);
        writeBox(stringerRef.current, stringerIndex++, position, euler, scale);
      }
    }

    // --- handrails ---------------------------------------------------------
    let railIndex = 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < segments; i++) {
        const t = ((i + 0.5) / segments) * 2 - 1;
        const { y, pitch } = archAt(t);
        position.set(side * railOffset, DECK_BASE + y + RAIL_HEIGHT, (t * length) / 2);
        euler.set(-pitch, 0, 0);
        scale.set(0.1, 0.1, (length / segments) * 1.04);
        writeBox(railRef.current, railIndex++, position, euler, scale);
      }
    }

    // --- posts between deck and rail ---------------------------------------
    let postIndex = 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let i = 0; i < postCount; i++) {
        // Pulled in off the very ends so the end posts stand on deck rather
        // than hanging off the abutment.
        const along = ((i / (postCount - 1)) * 2 - 1) * 0.86;
        const { y } = archAt(along);
        position.set(side * railOffset, DECK_BASE + y + RAIL_HEIGHT / 2, (along * length) / 2);
        euler.set(0, Math.sin(i * 3.1 + side) * 0.03, 0);
        scale.set(0.11, RAIL_HEIGHT, 0.11);
        writeBox(postRef.current, postIndex++, position, euler, scale);
      }
    }

    // --- piles into the bed ------------------------------------------------
    // Local Y is the deck's own frame, which sits on the bank lip, so the pile
    // has to reach from there down past the water surface to read as driven in
    // rather than as resting on it.
    const pileDrop = crossing.position[1] - WATER_LEVEL + 0.7;
    let pileIndex = 0;
    for (let side = -1; side <= 1; side += 2) {
      for (let end = -1; end <= 1; end += 2) {
        const along = end * 0.52;
        const { y } = archAt(along);
        position.set(
          side * (width / 2 - 0.2),
          DECK_BASE + y - pileDrop / 2,
          (along * length) / 2,
        );
        euler.set(end * 0.06, 0, side * 0.05);
        scale.set(0.16, pileDrop, 0.16);
        writeBox(pileRef.current, pileIndex++, position, euler, scale);
      }
    }

    for (const mesh of [
      plankRef.current,
      stringerRef.current,
      railRef.current,
      postRef.current,
      pileRef.current,
    ]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.raycast = () => {};
    }
  }, [layout, crossing.position]);

  return (
    <group position={crossing.position} rotation={[0, crossing.yaw, 0]}>
      <instancedMesh
        ref={plankRef}
        args={[undefined, undefined, layout.plankCount]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          color="#8a6b4a"
          map={wood.map}
          normalMap={wood.normalMap}
          normalScale={new THREE.Vector2(0.8, 0.8)}
          roughness={0.92}
          metalness={0}
        />
      </instancedMesh>

      <instancedMesh ref={stringerRef} args={[undefined, undefined, layout.segments * 2]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6a5137" roughness={0.95} metalness={0} />
      </instancedMesh>

      <instancedMesh ref={railRef} args={[undefined, undefined, layout.segments * 2]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#7d6042" roughness={0.9} metalness={0} />
      </instancedMesh>

      <instancedMesh ref={postRef} args={[undefined, undefined, layout.postCount * 2]} castShadow>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#6f5539" roughness={0.9} metalness={0} />
      </instancedMesh>

      <instancedMesh ref={pileRef} args={[undefined, undefined, 4]} castShadow>
        <cylinderGeometry args={[0.5, 0.42, 1, 6]} />
        <meshStandardMaterial color="#5b452f" roughness={0.97} metalness={0} />
      </instancedMesh>
    </group>
  );
}
