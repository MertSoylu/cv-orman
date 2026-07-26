"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Text } from "@react-three/drei";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { healthyToWilted, setHoverCursor } from "./utils";

/**
 * The exhibit placards.
 *
 * Museum logic, not signage logic: the plaque stands at the edge of the gravel
 * facing across the trail, so a visitor walking the path reads the name before
 * they look up at the tree. Every plaque is angled toward the walker rather
 * than billboarded at the camera, which is what makes them read as objects
 * standing in the world instead of labels floating over it.
 *
 * Posts, plates and health dots are three InstancedMeshes covering the whole
 * forest. Only the *text* is a per-tree object, and it is distance-gated with
 * hysteresis -- a hundred permanently-visible troika text meshes would be both
 * a wall of overlapping type and a hundred draw calls.
 */

// Sized against the undergrowth, not against the trees: at the original,
// more "realistic" placard scale the plaques disappeared into knee-high grass
// from the trail. They have to clear it to do their job.
const POST_HEIGHT = 1.42;
const PLATE_TILT = -0.56;
const PLATE_WIDTH = 1.78;
const PLATE_HEIGHT = 0.55;

/** Text appears inside this radius and disappears outside the far one. The gap is the hysteresis. */
const TEXT_LOD_NEAR = 34;
const TEXT_LOD_FAR = 44;

const HEALTH_BASE = new THREE.Color("#5f8a43");

export interface PlaquePlacement {
  id: string;
  label: string;
  healthStage: number;
  position: [number, number, number];
  /** Yaw that turns the plate to face across the trail. */
  yaw: number;
}

export interface PlaquesProps {
  placements: PlaquePlacement[];
  onSelect: (id: string) => void;
  hoveredIdRef: React.RefObject<string | null>;
}

export default function Plaques({ placements, onSelect, hoveredIdRef }: PlaquesProps) {
  const postRef = useRef<THREE.InstancedMesh>(null);
  const plateRef = useRef<THREE.InstancedMesh>(null);
  const dotRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3(1, 1, 1);
    const color = new THREE.Color();

    placements.forEach((placement, index) => {
      const [x, y, z] = placement.position;

      position.set(x, y + POST_HEIGHT / 2, z);
      euler.set(0, placement.yaw, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, scale);
      postRef.current?.setMatrixAt(index, matrix);

      // The plate leans back off the post like a real lectern placard, so it
      // catches the sky rather than presenting an edge-on sliver from above.
      position.set(x, y + POST_HEIGHT + 0.16, z);
      euler.set(PLATE_TILT, placement.yaw, 0);
      quaternion.setFromEuler(euler);
      matrix.compose(position, quaternion, scale);
      plateRef.current?.setMatrixAt(index, matrix);

      position.set(x, y + POST_HEIGHT + 0.36, z);
      matrix.compose(position, quaternion, scale);
      dotRef.current?.setMatrixAt(index, matrix);
      dotRef.current?.setColorAt(index, color.copy(healthyToWilted(HEALTH_BASE, placement.healthStage)));
    });

    for (const mesh of [postRef.current, plateRef.current, dotRef.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
    if (postRef.current) postRef.current.raycast = () => {};
    if (dotRef.current) dotRef.current.raycast = () => {};
  }, [placements]);

  useEffect(() => () => setHoverCursor(false), []);

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (event.instanceId === undefined) return;
    event.stopPropagation();
    const placement = placements[event.instanceId];
    if (placement) {
      hoveredIdRef.current = placement.id;
      setHoverCursor(true);
    }
  };

  const handlePointerOut = () => {
    hoveredIdRef.current = null;
    setHoverCursor(false);
  };

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    if (event.instanceId === undefined) return;
    event.stopPropagation();
    const placement = placements[event.instanceId];
    if (placement) onSelect(placement.id);
  };

  if (placements.length === 0) return null;

  return (
    <group>
      <instancedMesh ref={postRef} args={[undefined, undefined, placements.length]} castShadow receiveShadow>
        <cylinderGeometry args={[0.055, 0.075, POST_HEIGHT, 6]} />
        <meshStandardMaterial color="#4a3a2b" roughness={0.9} metalness={0.05} />
      </instancedMesh>

      <instancedMesh
        ref={plateRef}
        args={[undefined, undefined, placements.length]}
        castShadow
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <boxGeometry args={[PLATE_WIDTH, PLATE_HEIGHT, 0.035]} />
        {/* Weathered brass: enough metalness to catch the key light and mark the
            plaque as the one man-made thing near each tree. */}
        <meshStandardMaterial color="#9a7d4d" roughness={0.42} metalness={0.65} />
      </instancedMesh>

      <instancedMesh ref={dotRef} args={[undefined, undefined, placements.length]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <meshStandardMaterial roughness={0.45} metalness={0.1} toneMapped={false} />
      </instancedMesh>

      {placements.map((placement) => (
        <PlaqueText key={placement.id} placement={placement} />
      ))}
    </group>
  );
}

/**
 * One repo name, engraved on its plate. Mounted always but shown only close up:
 * troika builds an SDF glyph atlas per text instance, so toggling `visible`
 * costs nothing per frame while unmounting and remounting would rebuild it.
 */
function PlaqueText({ placement }: { placement: PlaquePlacement }) {
  const groupRef = useRef<THREE.Group>(null);
  const visible = useRef(false);

  const position = useMemo<[number, number, number]>(() => {
    const [x, y, z] = placement.position;
    // Sit just proud of the plate's front face, along the plate's own normal.
    const forward = new THREE.Vector3(0, 0, 0.03).applyEuler(
      new THREE.Euler(PLATE_TILT, placement.yaw, 0),
    );
    return [x + forward.x, y + POST_HEIGHT + 0.14 + forward.y, z + forward.z];
  }, [placement]);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;
    const distance = camera.position.distanceTo(group.position);
    // Hysteresis band: without it, a plaque sitting exactly on the threshold
    // flickers on and off as the camera breathes.
    if (visible.current && distance > TEXT_LOD_FAR) visible.current = false;
    else if (!visible.current && distance < TEXT_LOD_NEAR) visible.current = true;
    group.visible = visible.current;
  });

  return (
    <group ref={groupRef} position={position} rotation={[PLATE_TILT, placement.yaw, 0]} visible={false}>
      <Text
        fontSize={0.17}
        maxWidth={PLATE_WIDTH * 0.82}
        textAlign="center"
        anchorX="center"
        anchorY="middle"
        letterSpacing={0.02}
        color="#1f1a12"
        outlineWidth={0}
      >
        {placement.label}
      </Text>
    </group>
  );
}
