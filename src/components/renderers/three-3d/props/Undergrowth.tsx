"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { pathNormalAt, pathPointAt } from "@/lib/forest/path";
import { getGrassTuft, getLeafAtlas } from "../textures";
import { seededRandom } from "../utils";
import { setEmissiveIntensity, setUniform } from "../imperative";
import { applyWind, crossedCards, type WindUniforms } from "./wind";
import { insidePlot, type TreeMarkerPlacement } from "./TreeMarkers";
import {
  PLANE_SCALE,
  sampleTerrain,
  streamDistance,
  streamHalfWidth,
  terrainHeight,
  TRAIL_WIDTH,
} from "../terrain/heightfield";

/**
 * Everything growing on the valley floor that isn't a repo: grass, shrubs,
 * rocks, fallen logs, and the lanterns lining the trail.
 *
 * All of it is instanced -- five draw calls for the entire ground cover,
 * whatever the density -- and all of it is placed by rejection sampling
 * against the same `sampleTerrain` the ground mesh was built from, so nothing
 * grows in the water, on the gravel, or off a cliff face.
 *
 * Grass sway runs in the vertex shader off the instance's own world position,
 * so a field of ten thousand tufts costs the CPU nothing per frame.
 */

interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface UndergrowthProps {
  bounds: Bounds;
  /** Forward extent of the trail in plane units, for lantern placement. */
  sStart: number;
  sEnd: number;
  grassCount: number;
  detailCount: number;
  /** Specimen plots. Ground cover is cleared out of these -- a bed full of grass isn't a bed. */
  plots: TreeMarkerPlacement[];
  isDark: boolean;
  reducedMotion: boolean;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

/**
 * Rejection-sample points that a plant could actually grow on. Returns fewer
 * than `count` when the terrain is hostile, which is correct -- forcing the
 * count would put ferns in the stream.
 */
function scatter(
  count: number,
  bounds: Bounds,
  seed: string,
  options: {
    minPathDistance: number;
    maxSlope: number;
    maxPathDistance?: number;
    plots?: TreeMarkerPlacement[];
    /** Skip the terrain-richness thinning. Mown ground is even by definition. */
    evenCover?: boolean;
  },
): Placement[] {
  const rand = seededRandom(seed);
  const results: Placement[] = [];
  const attempts = count * 3;

  for (let i = 0; i < attempts && results.length < count; i++) {
    const x = THREE.MathUtils.lerp(bounds.minX, bounds.maxX, rand());
    const z = THREE.MathUtils.lerp(bounds.minZ, bounds.maxZ, rand());
    const sample = sampleTerrain(x, z);

    if (sample.pathDistance < options.minPathDistance) continue;
    if (options.maxPathDistance && sample.pathDistance > options.maxPathDistance) continue;
    if (sample.streamDistance < sample.streamHalfWidth * 1.15) continue;
    if (sample.slope > options.maxSlope) continue;
    if (options.plots && insidePlot(x, z, options.plots)) continue;
    // Thin the cover out where the ground reads as bare earth, so density
    // tracks the terrain's own vertex colouring instead of fighting it.
    if (!options.evenCover && rand() > 0.35 + sample.variation * 0.65) continue;

    results.push({
      x,
      y: sample.height,
      z,
      scale: 0.6 + rand() * 0.8,
      rotation: rand() * Math.PI * 2,
    });
  }

  return results;
}

function writeInstances(mesh: THREE.InstancedMesh | null, placements: Placement[], lift = 0): void {
  if (!mesh) return;
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const axis = new THREE.Vector3(0, 1, 0);

  placements.forEach((placement, index) => {
    position.set(placement.x, placement.y + lift, placement.z);
    quaternion.setFromAxisAngle(axis, placement.rotation);
    scale.setScalar(placement.scale);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(index, matrix);
  });

  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.raycast = () => {};
}

export default function Undergrowth({
  bounds,
  sStart,
  sEnd,
  grassCount,
  detailCount,
  plots,
  isDark,
  reducedMotion,
}: UndergrowthProps) {
  const windUniforms = useMemo<WindUniforms>(
    // THREE.Uniform, not `{ value }` -- see `imperative.ts`.
    () => ({
      uTime: new THREE.Uniform(0),
      uWindStrength: new THREE.Uniform(reducedMotion ? 0 : 1),
    }),
    // Seeded once; driven imperatively from here on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    setUniform(windUniforms.uWindStrength, reducedMotion ? 0 : 1);
  }, [reducedMotion, windUniforms]);

  useFrame(({ clock }) => {
    setUniform(windUniforms.uTime, clock.elapsedTime);
  });

  // Rough grass keeps back from the walk, leaving room for the mown band.
  const grass = useMemo(
    () =>
      scatter(grassCount, bounds, "grass", {
        minPathDistance: TRAIL_WIDTH * 1.15,
        maxSlope: 0.75,
        plots,
      }),
    [grassCount, bounds, plots],
  );
  /**
   * The mown fringe: the same tufts, cut short, filling the band between the
   * kerb and the rough grass.
   *
   * Leaving that band as bare vertex colour was the cheaper option and it read
   * as a bald strip -- the mown tint alone is not enough, because next to real
   * three-dimensional tufts a flat-shaded band looks like missing geometry
   * rather than short grass. Evenly covered rather than following the terrain's
   * richness, since the whole point of mown ground is that it is uniform.
   */
  const mown = useMemo(
    () =>
      scatter(Math.round(grassCount * 0.5), bounds, "mown", {
        minPathDistance: TRAIL_WIDTH * 0.66,
        maxPathDistance: TRAIL_WIDTH * 1.35,
        maxSlope: 0.6,
        plots,
        evenCover: true,
      }).map((placement) => ({ ...placement, scale: 0.26 + placement.scale * 0.16 })),
    [grassCount, bounds, plots],
  );
  // Shrubs start well back from the trail. They are the tallest ground cover in
  // the scene and the plaques stand just off the gravel, so anything closer
  // buries the exhibit's own labels in foliage.
  const shrubs = useMemo(
    () =>
      scatter(detailCount, bounds, "shrub", {
        minPathDistance: TRAIL_WIDTH * 1.6,
        maxSlope: 0.6,
        plots,
      }),
    [detailCount, bounds, plots],
  );
  const rocks = useMemo(
    () =>
      scatter(Math.round(detailCount * 0.55), bounds, "rock", {
        minPathDistance: TRAIL_WIDTH * 0.8,
        maxSlope: 1,
        plots,
      }),
    [detailCount, bounds, plots],
  );
  const logs = useMemo(
    () =>
      scatter(Math.max(4, Math.round(detailCount * 0.06)), bounds, "log", {
        minPathDistance: TRAIL_WIDTH * 1.9,
        maxSlope: 0.35,
        plots,
      }),
    [detailCount, bounds, plots],
  );

  const lanterns = useMemo(() => placeLanterns(sStart, sEnd), [sStart, sEnd]);

  return (
    <group>
      <GrassField placements={grass} windUniforms={windUniforms} />
      <GrassField placements={mown} windUniforms={windUniforms} />
      <ShrubField placements={shrubs} windUniforms={windUniforms} />
      <RockField placements={rocks} />
      <LogField placements={logs} />
      <Lanterns placements={lanterns} isDark={isDark} />
    </group>
  );
}

// ---------------------------------------------------------------------------

function GrassField({
  placements,
  windUniforms,
}: {
  placements: Placement[];
  windUniforms: WindUniforms;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => crossedCards(2), []);
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: getGrassTuft(),
      color: "#8ea35c",
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0,
    });
    applyWind(mat, windUniforms, "grass-wind", 0.3);
    return mat;
  }, [windUniforms]);

  useEffect(() => {
    const disposable = { geometry, material };
    return () => {
      disposable.geometry.dispose();
      disposable.material.dispose();
    };
  }, [geometry, material]);

  useLayoutEffect(() => {
    writeInstances(meshRef.current, placements);
  }, [placements]);

  if (placements.length === 0) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, placements.length]}
      frustumCulled={false}
      receiveShadow
    />
  );
}

function ShrubField({
  placements,
  windUniforms,
}: {
  placements: Placement[];
  windUniforms: WindUniforms;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => {
    const cards = crossedCards(3);
    cards.scale(1.2, 1, 1.2);
    return cards;
  }, []);
  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: getLeafAtlas("broad"),
      color: "#6f8a4b",
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.9,
      metalness: 0,
    });
    applyWind(mat, windUniforms, "shrub-wind", 0.16);
    return mat;
  }, [windUniforms]);

  useEffect(() => {
    const disposable = { geometry, material };
    return () => {
      disposable.geometry.dispose();
      disposable.material.dispose();
    };
  }, [geometry, material]);

  useLayoutEffect(() => {
    writeInstances(meshRef.current, placements);
  }, [placements]);

  if (placements.length === 0) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, placements.length]}
      frustumCulled={false}
      castShadow
      receiveShadow
    />
  );
}

function RockField({ placements }: { placements: Placement[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();

    placements.forEach((placement, index) => {
      // Rocks are half-buried and squashed, so they read as outcrops rather
      // than as spheres resting on the surface.
      position.set(placement.x, placement.y - placement.scale * 0.16, placement.z);
      euler.set(placement.rotation * 0.4, placement.rotation, placement.rotation * 0.25);
      quaternion.setFromEuler(euler);
      scale.set(placement.scale * 0.6, placement.scale * 0.4, placement.scale * 0.55);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.raycast = () => {};
  }, [placements]);

  if (placements.length === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, placements.length]} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color="#8a8073" roughness={0.95} metalness={0} flatShading />
    </instancedMesh>
  );
}

function LogField({ placements }: { placements: Placement[] }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();

    placements.forEach((placement, index) => {
      position.set(placement.x, placement.y + placement.scale * 0.22, placement.z);
      // Laid on its side and rolled slightly into the ground.
      euler.set(Math.PI / 2, placement.rotation, 0.12);
      quaternion.setFromEuler(euler);
      scale.set(placement.scale * 0.26, placement.scale * 3.4, placement.scale * 0.26);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.raycast = () => {};
  }, [placements]);

  if (placements.length === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, placements.length]} castShadow receiveShadow>
      <cylinderGeometry args={[1, 0.85, 1, 7, 1]} />
      <meshStandardMaterial color="#5d4a37" roughness={0.95} metalness={0} flatShading />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------

const LANTERN_SPACING = 320;
const LANTERN_HEIGHT = 1.9;

interface Lantern {
  position: [number, number, number];
}

function placeLanterns(sStart: number, sEnd: number): Lantern[] {
  const lanterns: Lantern[] = [];
  let side = 1;

  for (let s = sStart + LANTERN_SPACING * 0.5; s <= sEnd; s += LANTERN_SPACING) {
    const center = pathPointAt(s);
    const normal = pathNormalAt(s);
    const offset = (TRAIL_WIDTH / 2 + 0.55) * side;
    const x = center.x / PLANE_SCALE + normal.x * offset;
    const z = center.y / PLANE_SCALE + normal.y * offset;
    // Skip anything that would end up standing in the stream.
    if (Math.abs(streamDistance(x, z)) < streamHalfWidth(x) * 1.5) {
      side *= -1;
      continue;
    }
    lanterns.push({ position: [x, terrainHeight(x, z), z] });
    side *= -1;
  }

  return lanterns;
}

/**
 * Trail lanterns, as two instanced meshes -- posts and globes -- rather than a
 * group per lantern, so a dozen of them stay two draw calls.
 *
 * The globes are emissive, not real lights. A dozen shadow-casting point lights
 * would cost more than the entire rest of the scene; the bloom pass sells the
 * glow just as convincingly and costs nothing extra.
 */
function Lanterns({ placements, isDark }: { placements: Lantern[]; isDark: boolean }) {
  const postRef = useRef<THREE.InstancedMesh>(null);
  const globeRef = useRef<THREE.InstancedMesh>(null);
  const glow = useRef(isDark ? 1 : 0);

  const globeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffd9a0",
        emissive: new THREE.Color("#ffb85c"),
        emissiveIntensity: 0.15,
        roughness: 0.4,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => () => globeMaterial.dispose(), [globeMaterial]);

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    placements.forEach((lantern, index) => {
      const [x, y, z] = lantern.position;

      position.set(x, y + LANTERN_HEIGHT / 2, z);
      matrix.compose(position, quaternion, scale);
      postRef.current?.setMatrixAt(index, matrix);

      position.set(x, y + LANTERN_HEIGHT + 0.12, z);
      matrix.compose(position, quaternion, scale);
      globeRef.current?.setMatrixAt(index, matrix);
    });

    for (const mesh of [postRef.current, globeRef.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      mesh.raycast = () => {};
    }
  }, [placements]);

  useFrame((_, delta) => {
    glow.current = THREE.MathUtils.damp(glow.current, isDark ? 1 : 0, 1.6, delta);
    setEmissiveIntensity(globeMaterial, 0.15 + glow.current * 3.4);
  });

  if (placements.length === 0) return null;

  return (
    <group>
      <instancedMesh ref={postRef} args={[undefined, undefined, placements.length]} castShadow>
        <cylinderGeometry args={[0.05, 0.075, LANTERN_HEIGHT, 6]} />
        <meshStandardMaterial color="#3b3630" roughness={0.75} metalness={0.35} />
      </instancedMesh>
      <instancedMesh ref={globeRef} args={[undefined, globeMaterial, placements.length]}>
        <sphereGeometry args={[0.15, 12, 10]} />
      </instancedMesh>
    </group>
  );
}
