"use client";

import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Instance, Instances } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { QualityTier } from "@/hooks/useQualityTier";
import { seededRandom } from "./utils";

// Shared geometry templates -- one of each, instanced across the whole scene.
const GRASS_GEOMETRY = new THREE.ConeGeometry(0.045, 0.38, 4);
const PEBBLE_GEOMETRY = new THREE.SphereGeometry(0.07, 6, 5);
const ROCK_GEOMETRY = new THREE.DodecahedronGeometry(0.3, 0);
const SHRUB_GEOMETRY = new THREE.IcosahedronGeometry(0.32, 1);
const BACKDROP_TREE_GEOMETRY = new THREE.ConeGeometry(0.5, 1, 6);
const BACKDROP_HILL_GEOMETRY = new THREE.IcosahedronGeometry(1, 1);

const WOOD_COLOR = "#7a5b3a";
const DARK_WOOD_COLOR = "#453626";
const LAMP_GLOW_COLOR = "#ffcf8e";

export interface ExhibitEnvironmentProps {
  groundSize: [number, number];
  /** World-space X,Z center of the ground plane. */
  groundCenter: [number, number];
  pathLength: number;
  pathWidth: number;
  /** World positions of every tree, used to keep props from spawning inside a trunk. */
  treePositions: [number, number, number][];
  /** Fireflies are a night-garden detail -- skip them entirely under the day lighting preset. */
  showFireflies: boolean;
  /** Device capability tier -- trims props/fireflies/grass density on low-end clients. */
  qualityTier?: QualityTier;
}

interface InstanceTransform {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  color: THREE.Color;
}

function clearOfTrees(x: number, z: number, treePositions: [number, number, number][], minDistance: number): boolean {
  for (const [tx, , tz] of treePositions) {
    const dx = x - tx;
    const dz = z - tz;
    if (dx * dx + dz * dz < minDistance * minDistance) return false;
  }
  return true;
}

/**
 * Everything in the exhibit garden that isn't a tree or its placard: grass
 * tufts, boulders, the gravel path's pebble edging, bollard lamps, benches,
 * and drifting fireflies. All placement is seeded (fixed seed strings +
 * useMemo over the layout bounds), never Math.random.
 */
export default function ExhibitEnvironment({
  groundSize,
  groundCenter,
  pathLength,
  pathWidth,
  treePositions,
  showFireflies,
  qualityTier = "high",
}: ExhibitEnvironmentProps) {
  const [centerX, centerZ] = groundCenter;
  const pathHalf = pathWidth / 2;
  const grassDensity = qualityTier === "low" ? 0.2 : qualityTier === "mid" ? 0.35 : 0.44;
  const fireflyCount = qualityTier === "low" ? 40 : qualityTier === "mid" ? 70 : 110;

  const grass = useMemo<InstanceTransform[]>(() => {
    const rand = seededRandom("cv-orman:grass");
    const area = groundSize[0] * groundSize[1];
    const count = Math.min(900, Math.max(220, Math.round(area * grassDensity)));
    // Match the ground plane color (Forest3D "#66743c") so tufts read as the
    // same lawn, not a lighter layer sitting on top.
    const base = new THREE.Color("#66743c");
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);

    const tufts: InstanceTransform[] = [];
    while (tufts.length < count) {
      const x = centerX + (rand() - 0.5) * (groundSize[0] - 2);
      const z = centerZ + (rand() - 0.5) * (groundSize[1] - 2);
      if (Math.abs(x) < pathHalf + 0.35) continue; // keep the walkway clean
      const s = 0.6 + rand() * 0.9;
      const color = new THREE.Color();
      color.setHSL(hsl.h + (rand() - 0.5) * 0.03, hsl.s, THREE.MathUtils.clamp(hsl.l + (rand() - 0.5) * 0.12, 0, 1));
      tufts.push({
        position: [x, 0.12 * s, z],
        rotation: [(rand() - 0.5) * 0.3, rand() * Math.PI * 2, (rand() - 0.5) * 0.3],
        scale: [s, s, s],
        color,
      });
    }
    return tufts;
  }, [groundSize, centerX, centerZ, pathHalf, grassDensity]);

  const rocks = useMemo<InstanceTransform[]>(() => {
    const rand = seededRandom("cv-orman:rocks");
    const count = THREE.MathUtils.clamp(Math.round((groundSize[0] * groundSize[1]) / 150), 6, 16);
    const placed: InstanceTransform[] = [];
    let attempts = 0;
    while (placed.length < count && attempts < count * 20) {
      attempts++;
      const x = centerX + (rand() - 0.5) * (groundSize[0] - 4);
      const z = centerZ + (rand() - 0.5) * (groundSize[1] - 4);
      if (Math.abs(x) < pathHalf + 0.8) continue;
      if (!clearOfTrees(x, z, treePositions, 1.4)) continue;
      const s = 0.4 + rand() * 1.0;
      const grey = 0.5 + rand() * 0.14;
      placed.push({
        position: [x, s * 0.12, z],
        rotation: [rand() * Math.PI, rand() * Math.PI, rand() * Math.PI],
        scale: [s, s * (0.6 + rand() * 0.3), s],
        color: new THREE.Color(grey, grey * 0.96, grey * 0.86),
      });
    }
    return placed;
  }, [groundSize, centerX, centerZ, pathHalf, treePositions]);

  const shrubs = useMemo<InstanceTransform[]>(() => {
    const rand = seededRandom("cv-orman:shrubs");
    const area = groundSize[0] * groundSize[1];
    const count = THREE.MathUtils.clamp(Math.round(area / 34), 24, 90);
    const base = new THREE.Color("#4f6a3a");
    const hsl = { h: 0, s: 0, l: 0 };
    base.getHSL(hsl);
    const placed: InstanceTransform[] = [];
    let attempts = 0;
    while (placed.length < count && attempts < count * 20) {
      attempts++;
      const x = centerX + (rand() - 0.5) * (groundSize[0] - 3);
      const z = centerZ + (rand() - 0.5) * (groundSize[1] - 3);
      if (Math.abs(x) < pathHalf + 0.6) continue;
      if (!clearOfTrees(x, z, treePositions, 1.1)) continue;
      const s = 0.55 + rand() * 0.7;
      const color = new THREE.Color();
      color.setHSL(hsl.h + (rand() - 0.5) * 0.04, hsl.s, THREE.MathUtils.clamp(hsl.l + (rand() - 0.5) * 0.1, 0, 1));
      placed.push({
        position: [x, s * 0.28, z],
        rotation: [0, rand() * Math.PI * 2, 0],
        scale: [s, s * (0.7 + rand() * 0.4), s],
        color,
      });
    }
    return placed;
  }, [groundSize, centerX, centerZ, pathHalf, treePositions]);

  // Distant tree-line + hill silhouettes ringing the exhibit clearing --
  // matches the ground's aspect (an ellipse, not a circle, since the path is
  // long and narrow) so the horizon never reads as flat empty sky no matter
  // which way OrbitControls is spun. Colors lerp toward the fog's warm haze
  // so the ring reads as atmospheric distance, not a wall of cutouts.
  const backdrop = useMemo(() => {
    const rand = seededRandom("cv-orman:backdrop");
    const haze = new THREE.Color("#c99a76");
    // Dense + wide-based so adjacent cones overlap into a continuous
    // treeline silhouette instead of reading as scattered toothpicks.
    const treeCount = 70;
    const trees: InstanceTransform[] = [];
    for (let i = 0; i < treeCount; i++) {
      const angle = (i / treeCount) * Math.PI * 2 + rand() * 0.08;
      const rx = groundSize[0] / 2 + 14 + rand() * 8;
      const rz = groundSize[1] / 2 + 14 + rand() * 8;
      const x = centerX + Math.cos(angle) * rx;
      const z = centerZ + Math.sin(angle) * rz;
      const h = 1.6 + rand() * 2.4;
      // Kept close to the actual foliage tone with only a light warm rim --
      // full haze-orange read as solid rust cones instead of a hazy tree line.
      const color = new THREE.Color("#2e3d24").lerp(haze, 0.12 + rand() * 0.14);
      trees.push({
        // -0.15 seats the cone's base flush against the backdrop terrain
        // plane (Forest3D renders it at y=-0.15, well outside the real
        // ground plane's extent where these are placed).
        position: [x, h / 2 - 0.15, z],
        rotation: [0, rand() * Math.PI * 2, 0],
        scale: [0.75 + rand() * 0.55, h, 0.75 + rand() * 0.55],
        color,
      });
    }

    const hillCount = 22;
    const hills: InstanceTransform[] = [];
    for (let i = 0; i < hillCount; i++) {
      const angle = (i / hillCount) * Math.PI * 2 + rand() * 0.14;
      const rx = groundSize[0] / 2 + 24 + rand() * 12;
      const rz = groundSize[1] / 2 + 24 + rand() * 12;
      const x = centerX + Math.cos(angle) * rx;
      const z = centerZ + Math.sin(angle) * rz;
      const s = 2.8 + rand() * 3.2;
      // Farther than the tree line, so lean further into the pale haze --
      // aerial-perspective read: the furthest layer washes out lightest.
      const color = haze.clone().lerp(new THREE.Color("#e8956b"), 0.4 + rand() * 0.3);
      hills.push({
        position: [x, s * 0.1, z],
        rotation: [0, 0, 0],
        scale: [s, s * 0.35, s],
        color,
      });
    }
    return { trees, hills };
  }, [groundSize, centerX, centerZ]);

  const pebbles = useMemo<InstanceTransform[]>(() => {
    const rand = seededRandom("cv-orman:pebbles");
    const perSide = Math.max(12, Math.round(pathLength / 0.45));
    const startZ = centerZ - pathLength / 2;
    const stones: InstanceTransform[] = [];
    for (const side of [-1, 1]) {
      for (let i = 0; i < perSide; i++) {
        const z = startZ + (i / (perSide - 1)) * pathLength + (rand() - 0.5) * 0.3;
        const x = side * (pathHalf + 0.12 + rand() * 0.2);
        const s = 0.5 + rand() * 0.9;
        const tone = 0.55 + rand() * 0.18;
        stones.push({
          position: [x, 0.02, z],
          rotation: [0, rand() * Math.PI * 2, 0],
          scale: [s, s * 0.5, s],
          color: new THREE.Color(tone, tone * 0.87, tone * 0.68),
        });
      }
    }
    return stones;
  }, [pathLength, centerZ, pathHalf]);

  const lamps = useMemo(() => {
    const rand = seededRandom("cv-orman:lamps");
    const count = Math.max(2, Math.round(pathLength / 9));
    const startZ = centerZ - pathLength / 2 + 2;
    const span = pathLength - 4;
    const posts: { position: [number, number, number] }[] = [];
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const x = side * (pathHalf + 0.55) + (rand() - 0.5) * 0.2;
      const z = startZ + (count === 1 ? span / 2 : (i / (count - 1)) * span);
      if (!clearOfTrees(x, z, treePositions, 1.0)) continue;
      posts.push({ position: [x, 0, z] });
    }
    return posts;
  }, [pathLength, centerZ, pathHalf, treePositions]);

  const benches = useMemo(() => {
    const rand = seededRandom("cv-orman:benches");
    const count = Math.max(1, Math.floor(pathLength / 14));
    const startZ = centerZ - pathLength / 2 + 5;
    const span = Math.max(pathLength - 10, 1);
    const seats: { position: [number, number, number]; rotationY: number }[] = [];
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const x = side * (pathHalf + 1.4);
      const z = startZ + (count === 1 ? span / 2 : (i / (count - 1)) * span) + (rand() - 0.5) * 1.5;
      if (!clearOfTrees(x, z, treePositions, 1.7)) continue;
      // Face the walkway: seat's front (+Z in local space) turned toward plane x=0.
      seats.push({ position: [x, 0, z], rotationY: side > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
    return seats;
  }, [pathLength, centerZ, pathHalf, treePositions]);

  const lampCount = qualityTier === "low" ? Math.ceil(lamps.length / 2) : lamps.length;
  const benchCount = qualityTier === "low" ? Math.ceil(benches.length / 2) : benches.length;

  return (
    <group>
      <Instances limit={grass.length} geometry={GRASS_GEOMETRY} receiveShadow>
        <meshStandardMaterial roughness={1} metalness={0} />
        {grass.map((tuft, i) => (
          <Instance key={`g${i}`} position={tuft.position} rotation={tuft.rotation} scale={tuft.scale} color={tuft.color} />
        ))}
      </Instances>

      {rocks.length > 0 && (
        <Instances limit={rocks.length} geometry={ROCK_GEOMETRY} castShadow receiveShadow>
          <meshStandardMaterial roughness={0.95} metalness={0} />
          {rocks.map((rock, i) => (
            <Instance key={`r${i}`} position={rock.position} rotation={rock.rotation} scale={rock.scale} color={rock.color} />
          ))}
        </Instances>
      )}

      {shrubs.length > 0 && (
        <Instances limit={shrubs.length} geometry={SHRUB_GEOMETRY} castShadow receiveShadow>
          <meshStandardMaterial roughness={0.95} metalness={0} />
          {shrubs.map((shrub, i) => (
            <Instance key={`sh${i}`} position={shrub.position} rotation={shrub.rotation} scale={shrub.scale} color={shrub.color} />
          ))}
        </Instances>
      )}

      <Instances limit={pebbles.length} geometry={PEBBLE_GEOMETRY} receiveShadow>
        <meshStandardMaterial roughness={0.9} metalness={0} />
        {pebbles.map((stone, i) => (
          <Instance key={`s${i}`} position={stone.position} rotation={stone.rotation} scale={stone.scale} color={stone.color} />
        ))}
      </Instances>

      {lamps.slice(0, lampCount).map((lamp, i) => (
        <BollardLamp key={`lamp${i}`} position={lamp.position} />
      ))}

      {benches.slice(0, benchCount).map((bench, i) => (
        <Bench key={`bench${i}`} position={bench.position} rotationY={bench.rotationY} />
      ))}

      <Instances limit={backdrop.hills.length} geometry={BACKDROP_HILL_GEOMETRY} frustumCulled={false}>
        <meshStandardMaterial roughness={1} />
        {backdrop.hills.map((hill, i) => (
          <Instance key={`bh${i}`} position={hill.position} rotation={hill.rotation} scale={hill.scale} color={hill.color} />
        ))}
      </Instances>

      <Instances limit={backdrop.trees.length} geometry={BACKDROP_TREE_GEOMETRY} frustumCulled={false}>
        <meshStandardMaterial roughness={1} />
        {backdrop.trees.map((tree, i) => (
          <Instance key={`bt${i}`} position={tree.position} rotation={tree.rotation} scale={tree.scale} color={tree.color} />
        ))}
      </Instances>

      {showFireflies && <Fireflies center={groundCenter} size={groundSize} count={fireflyCount} />}
    </group>
  );
}

/** Knee-high path light: dark post, warm emissive head. No real point light -- at this count the glow alone sells it. */
function BollardLamp({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.33, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.06, 0.66, 6]} />
        <meshStandardMaterial color={DARK_WOOD_COLOR} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.72, 0]}>
        <sphereGeometry args={[0.085, 10, 8]} />
        <meshStandardMaterial color={LAMP_GLOW_COLOR} emissive={LAMP_GLOW_COLOR} emissiveIntensity={1.6} roughness={0.4} />
      </mesh>
    </group>
  );
}

/** Simple slatted garden bench facing the walkway. */
function Bench({ position, rotationY }: { position: [number, number, number]; rotationY: number }) {
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, 0.42, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.15, 0.06, 0.38]} />
        <meshStandardMaterial color={WOOD_COLOR} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.72, -0.19]} rotation={[-0.18, 0, 0]} castShadow>
        <boxGeometry args={[1.15, 0.3, 0.05]} />
        <meshStandardMaterial color={WOOD_COLOR} roughness={0.85} />
      </mesh>
      {[-0.45, 0.45].map((x) => (
        <mesh key={x} position={[x, 0.2, 0]} castShadow>
          <boxGeometry args={[0.07, 0.4, 0.34]} />
          <meshStandardMaterial color={DARK_WOOD_COLOR} roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Warm drifting specks over the garden -- additive points. The oscillation
 * itself runs in the vertex shader (spliced into the stock PointsMaterial
 * shader via onBeforeCompile) so the per-frame cost is two scalar uniform
 * writes instead of a CPU loop + full position-buffer re-upload.
 * Frozen at base position under prefers-reduced-motion via the uMotion
 * uniform, rather than skipping the frame callback.
 */
function Fireflies({ center, size, count }: { center: [number, number]; size: [number, number]; count: number }) {
  const reducedMotion = usePrefersReducedMotion();

  const { positions, params } = useMemo(() => {
    const rand = seededRandom("cv-orman:fireflies");
    const positions = new Float32Array(count * 3);
    const params = new Float32Array(count * 2); // phase, speed
    for (let i = 0; i < count; i++) {
      positions[i * 3] = center[0] + (rand() - 0.5) * size[0];
      positions[i * 3 + 1] = 0.5 + rand() * 2.9;
      positions[i * 3 + 2] = center[1] + (rand() - 0.5) * size[1];
      params[i * 2] = rand() * Math.PI * 2;
      params[i * 2 + 1] = 0.3 + rand() * 0.5;
    }
    return { positions, params };
  }, [center, size, count]);

  // A ref, not useMemo -- this object is mutated every frame below (react-hooks'
  // immutability rule forbids mutating a useMemo result), and shared by
  // reference into the compiled shader's uniforms in onBeforeCompile.
  const uniforms = useRef({
    uTime: { value: 0 },
    uMotion: { value: reducedMotion ? 0 : 1 },
  }).current;

  const handleBeforeCompile = useMemo(() => {
    return (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uMotion = uniforms.uMotion;
      shader.vertexShader =
        "attribute vec2 aParams;\nuniform float uTime;\nuniform float uMotion;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          "#include <begin_vertex>\n" +
            "float phase = aParams.x;\n" +
            "float speed = aParams.y;\n" +
            "transformed += vec3(\n" +
            "  sin(uTime * speed * 0.6 + phase * 2.1) * 0.4,\n" +
            "  sin(uTime * speed + phase) * 0.35,\n" +
            "  cos(uTime * speed * 0.5 + phase) * 0.4\n" +
            ") * uMotion;"
        );
    };
  }, [uniforms]);

  useFrame(({ clock }) => {
    uniforms.uTime.value = clock.elapsedTime;
    uniforms.uMotion.value = reducedMotion ? 0 : 1;
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aParams" args={[params, 2]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.09}
        color="#ffd98a"
        transparent
        opacity={0.85}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
        onBeforeCompile={handleBeforeCompile}
      />
    </points>
  );
}
