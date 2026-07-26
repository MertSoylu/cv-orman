"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { getGrassTuft, getMistTexture } from "../textures";
import { seededRandom } from "../utils";
import { setOpacity, setUniform } from "../imperative";
import { applyWind, crossedCards, type WindUniforms } from "./wind";
import {
  pathDistance,
  streamDistance,
  streamFlow,
  streamHalfWidth,
  terrainHeight,
  TRAIL_WIDTH,
  WATER_LEVEL,
  WATERLINE_FRACTION,
} from "../terrain/heightfield";

/**
 * Everything that belongs to the water's edge: reeds in the shallows, rolled
 * stones on the margin, lily pads on the slack pools, and a low mist that sits
 * over the channel.
 *
 * A stream with a clean vertex-coloured sand band either side of it reads as a
 * texture change in the ground, not as water: what makes a watercourse legible
 * is the stuff that only grows where the ground is wet. So everything here is
 * placed against the *channel*, not against the terrain at large -- offsets are
 * expressed as a fraction of `streamHalfWidth` at that point, which means the
 * whole margin widens with the pools and pinches into the narrows for free.
 *
 * All four are instanced: the entire waterside is four draw calls plus one mist
 * strip, whatever the density.
 */

/**
 * The bed is parabolic, so the waterline sits at a fixed *fraction* of the
 * half-width rather than at a fixed distance. That fraction is what everything
 * here is placed against -- it lives in `heightfield.ts` because the bridge's
 * span is measured against it too.
 */
const WATERLINE = WATERLINE_FRACTION;

interface Placement {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

export interface WatersideProps {
  /** Half-extent along world X the stream is drawn over -- same value `Water` gets. */
  extent: number;
  reedCount: number;
  /** Lily pads and the mist strip. Off on the low tier: both are pure fill rate. */
  waterDetail: boolean;
  isDark: boolean;
  reducedMotion: boolean;
}

/**
 * Rejection-sample points on the channel margin.
 *
 * `bandNear`/`bandFar` are fractions of the local half-width: 0 is the
 * centerline, `WATERLINE` is where the surface meets the bed, 1 is the bank
 * lip. `maxFlow` keeps a plant out of water moving too fast for it to root in.
 */
function scatterAlongStream(
  count: number,
  extent: number,
  seed: string,
  options: { bandNear: number; bandFar: number; maxFlow: number; minPathDistance: number },
): Placement[] {
  const rand = seededRandom(seed);
  const results: Placement[] = [];
  const attempts = count * 4;

  for (let i = 0; i < attempts && results.length < count; i++) {
    const x = THREE.MathUtils.lerp(-extent, extent, rand());
    const flow = streamFlow(x);
    // Thinned rather than cut off: a hard flow threshold leaves a visible line
    // across the stream where the planting stops.
    if (flow > options.maxFlow) continue;
    if (rand() < flow * 0.75) continue;

    const halfWidth = streamHalfWidth(x);
    const side = rand() < 0.5 ? -1 : 1;
    const band = THREE.MathUtils.lerp(options.bandNear, options.bandFar, rand());
    // `streamDistance(x, z) = z - wander(x)`, so sampling at z = 0 gives the
    // centerline, the same way the water strip finds it.
    const z = -streamDistance(x, 0) + side * halfWidth * band;

    // Nothing grows through the bridge or across its approach.
    if (pathDistance(x, z) < options.minPathDistance) continue;

    results.push({
      x,
      y: terrainHeight(x, z),
      z,
      scale: 0.65 + rand() * 0.7,
      rotation: rand() * Math.PI * 2,
    });
  }

  return results;
}

export default function Waterside({
  extent,
  reedCount,
  waterDetail,
  isDark,
  reducedMotion,
}: WatersideProps) {
  // Its own uniforms rather than Undergrowth's, but driven off the same
  // `clock.elapsedTime`, so the reeds and the grass behind them bend on
  // identical gusts without either component knowing about the other.
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

  // Reeds stand in the shallows and just above them -- rooted in water, leaning
  // over the bank. Straddling the waterline is what ties the two together.
  const reeds = useMemo(
    () =>
      scatterAlongStream(reedCount, extent, "reeds", {
        bandNear: WATERLINE * 0.82,
        bandFar: 1.04,
        maxFlow: 0.72,
        minPathDistance: TRAIL_WIDTH * 0.95,
      }),
    [reedCount, extent],
  );

  const stones = useMemo(
    () =>
      scatterAlongStream(Math.round(reedCount * 0.28), extent, "bank-stones", {
        bandNear: WATERLINE * 0.9,
        bandFar: 1.3,
        maxFlow: 1,
        minPathDistance: TRAIL_WIDTH * 0.8,
      }),
    [reedCount, extent],
  );

  // Lily pads only make sense on slack water, so they are the one thing here
  // held well inside the waterline and cut off hard at the first sign of flow.
  const lilies = useMemo(
    () =>
      waterDetail
        ? scatterAlongStream(Math.round(reedCount * 0.13), extent, "lilies", {
            bandNear: 0.1,
            bandFar: WATERLINE * 0.78,
            maxFlow: 0.22,
            minPathDistance: TRAIL_WIDTH * 1.5,
          })
        : [],
    [reedCount, extent, waterDetail],
  );

  return (
    <group>
      <Reeds placements={reeds} windUniforms={windUniforms} />
      <BankStones placements={stones} />
      {waterDetail && <LilyPads placements={lilies} />}
      {waterDetail && (
        <StreamMist extent={extent} isDark={isDark} reducedMotion={reducedMotion} />
      )}
    </group>
  );
}

// ---------------------------------------------------------------------------

function Reeds({
  placements,
  windUniforms,
}: {
  placements: Placement[];
  windUniforms: WindUniforms;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const geometry = useMemo(() => {
    // Narrow and tall, against the grass tuft's squat proportions: the same
    // image reads as a reed bed purely from the aspect ratio.
    const cards = crossedCards(2);
    cards.scale(0.4, 1, 0.4);
    return cards;
  }, []);

  const material = useMemo(() => {
    const mat = new THREE.MeshStandardMaterial({
      map: getGrassTuft(),
      color: "#93a054",
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.95,
      metalness: 0,
    });
    // Reeds are top-heavy and stand in open water, so they take the wind harder
    // than the grass in the lee of the trees.
    applyWind(mat, windUniforms, "reed-wind", 0.42);
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
    const mesh = meshRef.current;
    if (!mesh) return;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();

    placements.forEach((placement, index) => {
      // Seated below the bed surface: a reed whose base is visible reads as a
      // card standing on the water rather than as a stem coming out of it.
      position.set(placement.x, placement.y - 0.12, placement.z);
      quaternion.setFromAxisAngle(axis, placement.rotation);
      // Half again the height of the grass behind them and no more. Reeds tall
      // enough to be botanically right stand higher than the plaques and read
      // from the trail as an overgrown verge rather than as a waterline.
      scale.set(placement.scale * 0.8, placement.scale * 1.5, placement.scale * 0.8);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.raycast = () => {};
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

function BankStones({ placements }: { placements: Placement[] }) {
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
      position.set(placement.x, placement.y - placement.scale * 0.2, placement.z);
      euler.set(placement.rotation * 0.3, placement.rotation, placement.rotation * 0.2);
      quaternion.setFromEuler(euler);
      // Flatter and rounder than the hillside outcrops -- these are stones the
      // water has rolled, not rock it has exposed.
      scale.set(placement.scale * 0.5, placement.scale * 0.26, placement.scale * 0.44);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.raycast = () => {};
  }, [placements]);

  if (placements.length === 0) return null;
  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, placements.length]}
      castShadow
      receiveShadow
    >
      <icosahedronGeometry args={[1, 1]} />
      <meshStandardMaterial color="#9a9288" roughness={0.9} metalness={0} flatShading />
    </instancedMesh>
  );
}

/**
 * Lily pads float on the surface, so they ignore the terrain entirely and sit
 * at the water level with a slight tilt -- laid perfectly flat they catch the
 * key light as one identical disc each and read as decals.
 */
function LilyPads({ placements }: { placements: Placement[] }) {
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
      position.set(placement.x, WATER_LEVEL + 0.035, placement.z);
      euler.set(
        -Math.PI / 2 + Math.sin(placement.rotation * 3.1) * 0.06,
        0,
        placement.rotation,
      );
      quaternion.setFromEuler(euler);
      scale.setScalar(placement.scale * 0.62);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.raycast = () => {};
  }, [placements]);

  if (placements.length === 0) return null;
  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, placements.length]} receiveShadow>
      {/* Eight-sided, with the notch a real lily pad has cut out by leaving one
          segment of the fan open. */}
      <circleGeometry args={[1, 9, 0.35, Math.PI * 1.86]} />
      <meshStandardMaterial
        color="#4a6b3c"
        roughness={0.55}
        metalness={0}
        side={THREE.DoubleSide}
      />
    </instancedMesh>
  );
}

// ---------------------------------------------------------------------------

const MIST_HALF_WIDTH = 11;
const MIST_LAYERS = [
  { height: 0.55, speed: 0.007, opacity: 0.17, tile: 0.05 },
  { height: 1.25, speed: -0.0042, opacity: 0.1, tile: 0.031 },
];

const MIST_DAY = new THREE.Color("#e8e0cd");
const MIST_NIGHT = new THREE.Color("#93a6c2");

/**
 * Mist lying along the channel.
 *
 * Bound to the stream rather than to the valley: river mist sits over the
 * water and thins out within a few metres of the bank, and a plane wide enough
 * to cover the whole terrain would put it over the hilltops too. The strip
 * follows the same wander the water does, so it stays centred on the channel
 * however far the stream swings.
 */
function StreamMist({
  extent,
  isDark,
  reducedMotion,
}: {
  extent: number;
  isDark: boolean;
  reducedMotion: boolean;
}) {
  const dayFactor = useRef(isDark ? 0 : 1);

  const geometry = useMemo(() => {
    const step = 4;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    let column = 0;
    for (let x = -extent; x <= extent; x += step, column++) {
      const wander = -streamDistance(x, 0);
      for (let side = -1; side <= 1; side += 2) {
        positions.push(x, 0, wander + side * MIST_HALF_WIDTH);
        uvs.push(x, side === -1 ? 0 : 1);
      }
    }

    for (let c = 0; c + 1 < column; c++) {
      const a = c * 2;
      const b = (c + 1) * 2;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    return geo;
  }, [extent]);

  const layers = useMemo(
    () =>
      MIST_LAYERS.map((layer) => {
        // One shared source image, one clone per layer, so each gets its own
        // offset and repeat without decoding the noise twice.
        const texture = getMistTexture().clone();
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(layer.tile, 1);
        texture.needsUpdate = true;

        const material = new THREE.MeshBasicMaterial({
          map: texture,
          color: MIST_DAY.clone(),
          transparent: true,
          opacity: layer.opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        });

        return { ...layer, texture, material };
      }),
    [],
  );

  useEffect(
    () => () => {
      geometry.dispose();
      for (const layer of layers) {
        layer.texture.dispose();
        layer.material.dispose();
      }
    },
    [geometry, layers],
  );

  useFrame((_, delta) => {
    dayFactor.current = reducedMotion
      ? isDark
        ? 0
        : 1
      : THREE.MathUtils.damp(dayFactor.current, isDark ? 0 : 1, 1.6, delta);

    for (const layer of layers) {
      if (!reducedMotion) {
        layer.texture.offset.setX(layer.texture.offset.x + layer.speed * delta * 12);
      }
      layer.material.color.copy(MIST_NIGHT).lerp(MIST_DAY, dayFactor.current);
      // Strongest at night and at dawn; by day the channel is just damp air.
      setOpacity(layer.material, layer.opacity * THREE.MathUtils.lerp(1, 0.4, dayFactor.current));
    }
  });

  return (
    <group>
      {layers.map((layer, index) => (
        <mesh
          key={layer.height}
          geometry={geometry}
          material={layer.material}
          position={[0, WATER_LEVEL + layer.height, 0]}
          renderOrder={14 + index}
          raycast={() => null}
        />
      ))}
    </group>
  );
}
