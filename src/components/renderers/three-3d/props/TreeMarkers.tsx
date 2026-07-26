"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { getGroundTextures } from "../textures";
import { setEmissiveIntensity } from "../imperative";
import { terrainHeight } from "../terrain/heightfield";

/**
 * The plot that says "this tree is an exhibit".
 *
 * Without it the repo trees are indistinguishable from the filler wood around
 * them: same species, same silhouette, same colour, and the only thing setting
 * them apart -- the plaque -- is legible from the trail and from nowhere else.
 * A visitor who steps off the path immediately loses track of which trees are
 * the point.
 *
 * So every specimen stands in a **plot squared to the walk**: a cleared bed
 * whose long axis runs with the trail, edged in the same dressed stone as the
 * kerb, with a couple of stepping stones leading back to it and a lantern on
 * the trail-side corner. The shape is doing the work here. An earlier version
 * used a hand-wobbled circle, which is what a clearing made by weather looks
 * like; a rectangle aligned to the path is what a clearing made by a gardener
 * looks like, and the whole exhibit turns on the difference. Because every plot
 * takes its angle from the trail's own tangent, the plots down one side of the
 * walk stay parallel to each other however far the trail winds.
 *
 * Five instanced meshes plus one conformed bed geometry, regardless of repo
 * count.
 */

/** Dressed blocks edging one plot. Enough to read as a continuous kerb at trail distance. */
const EDGE_STONES = 28;
const EDGE_HEIGHT = 0.16;
const EDGE_THICKNESS = 0.1;
/** Fraction of a block's height that sits below the ground. */
const EDGE_BURIAL = 0.34;
const LANTERN_HEIGHT = 1.15;
/** Roughly one pace between stepping stones on the spur. */
const SPUR_PITCH = 0.62;
const SPUR_STONE = 0.44;

/**
 * Superellipse exponent for the plot outline. 2 is an ellipse and reads as
 * organic; much above 6 is a hard rectangle whose corners fight the terrain
 * displacement. 4 is a rounded rectangle -- unmistakably squared to the walk,
 * still soft enough to sit on rolling ground.
 */
const PLOT_EXPONENT = 4;

export interface TreeMarkerPlacement {
  id: string;
  /** Base of the tree, already dropped onto the terrain. */
  position: [number, number, number];
  /** Yaw that lays the plot's long axis along the trail at this specimen's station. */
  yaw: number;
  /** Half-extent across the walk (toward and away from it). */
  halfAcross: number;
  /** Half-extent along the walk. */
  halfAlong: number;
  /**
   * Local-X direction from the specimen toward the trail: +1 for a tree on the
   * right of the direction of travel, -1 for one on the left. Places the lantern
   * and aims the spur without either of them re-deriving which way the walk is.
   */
  towardTrail: number;
  /** World XZ on the kerb that the stepping stones lead back to. */
  spurAnchor: [number, number];
}

export interface TreeMarkersProps {
  placements: TreeMarkerPlacement[];
  isDark: boolean;
}

/**
 * Distance from a plot's centre to its outline at `angle`, where the angle's
 * cosine runs across the walk and its sine runs along it.
 */
function plotRadius(angle: number, halfAcross: number, halfAlong: number): number {
  const across = Math.abs(Math.cos(angle) / halfAcross);
  const along = Math.abs(Math.sin(angle) / halfAlong);
  return Math.pow(
    Math.pow(across, PLOT_EXPONENT) + Math.pow(along, PLOT_EXPONENT),
    -1 / PLOT_EXPONENT,
  );
}

/**
 * True where a world XZ falls inside a specimen's plot.
 *
 * `Undergrowth` rejects against this so grass and shrubs stop at the edging
 * instead of growing straight through a cleared bed. Testing the real
 * superellipse rather than a bounding circle matters here: the plots are up to
 * three times longer than they are wide, and a circle that covered one would
 * scrub a bald patch out of the turf either side of it.
 */
export function insidePlot(
  x: number,
  z: number,
  placements: TreeMarkerPlacement[],
  margin = 0,
): boolean {
  for (const placement of placements) {
    const cos = Math.cos(placement.yaw);
    const sin = Math.sin(placement.yaw);
    const dx = x - placement.position[0];
    const dz = z - placement.position[2];
    const across = Math.abs(dx * cos - dz * sin) / (placement.halfAcross + margin);
    const along = Math.abs(dx * sin + dz * cos) / (placement.halfAlong + margin);
    if (Math.pow(across, PLOT_EXPONENT) + Math.pow(along, PLOT_EXPONENT) <= 1) return true;
  }
  return false;
}

/** Rotate a plot-local XZ offset into world space and add it to the plot's origin. */
function toWorld(
  placement: TreeMarkerPlacement,
  across: number,
  along: number,
): [number, number] {
  const cos = Math.cos(placement.yaw);
  const sin = Math.sin(placement.yaw);
  return [
    placement.position[0] + across * cos + along * sin,
    placement.position[2] - across * sin + along * cos,
  ];
}

/** World XZ of the point on a plot's outline at `angle`. */
function outlinePoint(placement: TreeMarkerPlacement, angle: number): [number, number] {
  const radius = plotRadius(angle, placement.halfAcross, placement.halfAlong);
  return toWorld(placement, Math.cos(angle) * radius, Math.sin(angle) * radius);
}

/**
 * Every plot in the exhibit as one geometry, each one's vertices dropped onto
 * the terrain.
 *
 * The obvious build is an instanced quad, and it is wrong: a flat plane on
 * sloping ground either floats on the downhill side or has the hill cut a bite
 * out of it, and a specimen standing in what looks like a hovering tile is
 * worse than no marker at all. Conforming means per-tree vertices, but there
 * are only ever a handful of repo trees, so the whole exhibit's plots still come
 * to one draw call and a couple of thousand triangles.
 */
function buildPlotGeometry(placements: TreeMarkerPlacement[]): THREE.BufferGeometry {
  const SEGMENTS = 40;
  const RINGS = [0, 0.55, 0.85, 1];
  /** World units of ground per tile of the grain map -- matches `Terrain`. */
  const GRAIN_TILE = 7;

  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  // Pale raked gravel, not bare earth.
  //
  // The bed was dark brown to begin with, and at that value it was invisible:
  // dark earth under a canopy sits at almost exactly the luminance of turf in
  // shade, so the plots read as nothing at all from more than a few paces and
  // the specimens went back to looking like any other tree. Pale reverses that
  // completely -- each specimen now stands on a light disc that carries at any
  // distance, in either theme -- and it costs nothing in cohesion, because it is
  // the same gravel as the walk and the same stone as the edging.
  const centerColor = new THREE.Color("#bda887");
  const rimColor = new THREE.Color("#a48d69");
  const color = new THREE.Color();

  for (const placement of placements) {
    const base = positions.length / 3;

    for (let ring = 0; ring < RINGS.length; ring++) {
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const angle = (seg / SEGMENTS) * Math.PI * 2;
        const radius =
          plotRadius(angle, placement.halfAcross, placement.halfAlong) * RINGS[ring];
        const [x, z] = toWorld(
          placement,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius,
        );

        positions.push(x, terrainHeight(x, z) + 0.025, z);
        uvs.push(x / GRAIN_TILE, z / GRAIN_TILE);
        color.copy(centerColor).lerp(rimColor, RINGS[ring]);
        colors.push(color.r, color.g, color.b);
      }
    }

    // Winding matters and is easy to get backwards here: with the rings laid
    // out as (cos, sin) in the XZ plane, the order below is what puts the face
    // normals along +Y. The mirror of it -- (a, c, b) / (b, c, d), which reads
    // just as naturally -- points them at the ground, and since the material is
    // `FrontSide` and `computeVertexNormals` takes its normals from the winding,
    // the plots then draw nothing at all. Not dark, not z-fighting: nothing,
    // from every angle, with no error anywhere.
    for (let ring = 0; ring + 1 < RINGS.length; ring++) {
      for (let seg = 0; seg < SEGMENTS; seg++) {
        const next = (seg + 1) % SEGMENTS;
        const a = base + ring * SEGMENTS + seg;
        const b = base + ring * SEGMENTS + next;
        const c = base + (ring + 1) * SEGMENTS + seg;
        const d = base + (ring + 1) * SEGMENTS + next;
        indices.push(a, b, c, b, d, c);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

/** Stepping stones from the kerb to the plot's trail-side edge, for one specimen. */
function spurStones(placement: TreeMarkerPlacement): { x: number; z: number; yaw: number }[] {
  const edge = toWorld(placement, placement.towardTrail * placement.halfAcross, 0);
  const [ax, az] = placement.spurAnchor;
  const dx = edge[0] - ax;
  const dz = edge[1] - az;
  const length = Math.hypot(dx, dz);
  if (length < SPUR_PITCH) return [];

  const yaw = Math.atan2(dx, dz);
  const count = Math.max(2, Math.round(length / SPUR_PITCH));
  const stones = [];
  for (let i = 0; i < count; i++) {
    // Inset from both ends: a stone flush with the kerb reads as part of it,
    // and one flush with the plot edge fights the edging stones.
    const t = (i + 0.5) / count;
    stones.push({ x: ax + dx * t, z: az + dz * t, yaw });
  }
  return stones;
}

export default function TreeMarkers({ placements, isDark }: TreeMarkersProps) {
  const edgeRef = useRef<THREE.InstancedMesh>(null);
  const spurRef = useRef<THREE.InstancedMesh>(null);
  const postRef = useRef<THREE.InstancedMesh>(null);
  const globeRef = useRef<THREE.InstancedMesh>(null);
  const glow = useRef(isDark ? 1 : 0);

  const ground = useMemo(() => getGroundTextures(), []);
  const plotGeometry = useMemo(() => buildPlotGeometry(placements), [placements]);
  const spurs = useMemo(() => placements.flatMap(spurStones), [placements]);

  useEffect(() => () => plotGeometry.dispose(), [plotGeometry]);

  const globeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#ffe0b0",
        emissive: new THREE.Color("#ffb85c"),
        emissiveIntensity: 0.6,
        roughness: 0.35,
        toneMapped: false,
      }),
    [],
  );

  useEffect(() => () => globeMaterial.dispose(), [globeMaterial]);

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const scale = new THREE.Vector3();
    const unit = new THREE.Vector3(1, 1, 1);

    let edgeIndex = 0;

    placements.forEach((placement, index) => {
      // --- edging ----------------------------------------------------------
      // Each block spans the *chord* between two outline samples: it sits at
      // their midpoint, is exactly as long as the gap between them, and is
      // yawed along it. Sampling one point per block and guessing its length
      // from `2 pi r / n` looks equivalent and is not -- on a superellipse the
      // arc covered per unit angle varies by a factor of two between the flats
      // and the corners, so the run came out overlapping at the corners and
      // gapped down the sides.
      for (let i = 0; i < EDGE_STONES; i++) {
        const [x0, z0] = outlinePoint(placement, (i / EDGE_STONES) * Math.PI * 2);
        const [x1, z1] = outlinePoint(placement, ((i + 1) / EDGE_STONES) * Math.PI * 2);
        const x = (x0 + x1) / 2;
        const z = (z0 + z1) / 2;

        position.set(x, terrainHeight(x, z) + EDGE_HEIGHT * (0.5 - EDGE_BURIAL), z);
        euler.set(0, Math.atan2(x1 - x0, z1 - z0), 0);
        quaternion.setFromEuler(euler);
        // A hair longer than the chord, so the joints close rather than showing
        // a sliver of turf at every one of them.
        scale.set(EDGE_THICKNESS, EDGE_HEIGHT, Math.hypot(x1 - x0, z1 - z0) * 1.06);
        matrix.compose(position, quaternion, scale);
        edgeRef.current?.setMatrixAt(edgeIndex++, matrix);
      }

      // --- the lantern -----------------------------------------------------
      // Always the trail-side corner at the far end of the plot, never a
      // resolved-per-tree position: the two specimens of a station then carry
      // mirrored lanterns, and walking the trail gives a regular file of lights
      // rather than a scatter.
      const [lanternX, lanternZ] = toWorld(
        placement,
        placement.towardTrail * placement.halfAcross * 0.86,
        placement.halfAlong * 0.82,
      );
      const groundY = terrainHeight(lanternX, lanternZ);

      position.set(lanternX, groundY + LANTERN_HEIGHT / 2, lanternZ);
      matrix.compose(position, quaternion.identity(), unit);
      postRef.current?.setMatrixAt(index, matrix);

      position.set(lanternX, groundY + LANTERN_HEIGHT + 0.1, lanternZ);
      matrix.compose(position, quaternion, unit);
      globeRef.current?.setMatrixAt(index, matrix);
    });

    spurs.forEach((stone, index) => {
      position.set(stone.x, terrainHeight(stone.x, stone.z) + 0.015, stone.z);
      euler.set(0, stone.yaw, 0);
      quaternion.setFromEuler(euler);
      scale.set(SPUR_STONE, 0.09, SPUR_STONE * 0.78);
      matrix.compose(position, quaternion, scale);
      spurRef.current?.setMatrixAt(index, matrix);
    });

    for (const mesh of [edgeRef.current, spurRef.current, postRef.current, globeRef.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
      // Every pointer event in the forest goes through TreeField's hit proxies;
      // a marker that swallowed clicks would create dead spots right where the
      // tree is easiest to aim at.
      mesh.raycast = () => {};
    }
  }, [placements, spurs]);

  useFrame((_, delta) => {
    glow.current = THREE.MathUtils.damp(glow.current, isDark ? 1 : 0, 1.6, delta);
    // A higher day floor than the trail lanterns get. These are wayfinding, not
    // atmosphere: they have to stay visible as warm points in full daylight,
    // when nothing else about a repo tree distinguishes it at range.
    setEmissiveIntensity(globeMaterial, 0.6 + glow.current * 3.2);
  });

  if (placements.length === 0) return null;

  return (
    <group>
      {/* Draws just above the terrain rather than z-fighting with it, and takes
          shadows so the tree it belongs to is cast across its own plot. */}
      <mesh geometry={plotGeometry} receiveShadow raycast={() => null}>
        <meshStandardMaterial
          vertexColors
          map={ground.map}
          normalMap={ground.normalMap}
          roughnessMap={ground.roughnessMap}
          normalScale={new THREE.Vector2(0.9, 0.9)}
          roughness={1}
          metalness={0}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>

      {/* The same limestone as the trail kerb, deliberately: one stone in the
          exhibit, cut two ways. */}
      <instancedMesh
        ref={edgeRef}
        args={[undefined, undefined, placements.length * EDGE_STONES]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#a29a89" roughness={0.85} metalness={0} />
      </instancedMesh>

      {spurs.length > 0 && (
        <instancedMesh ref={spurRef} args={[undefined, undefined, spurs.length]} receiveShadow>
          <cylinderGeometry args={[0.5, 0.46, 1, 6]} />
          <meshStandardMaterial color="#a29b8d" roughness={0.88} metalness={0} flatShading />
        </instancedMesh>
      )}

      <instancedMesh ref={postRef} args={[undefined, undefined, placements.length]} castShadow>
        <cylinderGeometry args={[0.035, 0.05, LANTERN_HEIGHT, 6]} />
        <meshStandardMaterial color="#3b3630" roughness={0.75} metalness={0.35} />
      </instancedMesh>

      <instancedMesh ref={globeRef} args={[undefined, globeMaterial, placements.length]}>
        <sphereGeometry args={[0.12, 10, 8]} />
      </instancedMesh>
    </group>
  );
}
