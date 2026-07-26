"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { PlacedTreeData, Species } from "@/lib/forest/treeData";
import { getBarkTextures, getLeafAtlas } from "../textures";
import { setUniform } from "../imperative";
import { growthToScale, healthyToWilted, introProgress, setHoverCursor, smoothstep } from "../utils";
import { buildDecorTrees, type DecorBounds } from "./decor";
import { getSpeciesBuild, getTreeJitter, getTreeMetrics, getVariantIndex } from "./registry";
import { TreeStateBuffer } from "./treeState";
import { createTreeDepthMaterial, createTreeUniforms, patchTreeMaterial } from "./treeShader";

/**
 * The whole forest, in a handful of draw calls.
 *
 * Every tree in the scene -- the repo trees and the unlabelled filler that
 * turns a dozen repos into a wood -- goes into the same buckets, keyed by
 * (species, variant). Each bucket draws its bark, leaf cards and far-LOD canopy
 * hull as one InstancedMesh apiece, with one instance per tree and a *static*
 * instance matrix. A single hit-proxy mesh, invisible and sixteen triangles per
 * tree, carries every pointer event for the entire forest, so hovering never
 * raycasts the real foliage.
 *
 * Per frame this component writes four floats per tree into `TreeStateBuffer`
 * and advances one clock uniform. That is the entire CPU cost of animating the
 * scene, at any tree count.
 */

/**
 * Camera distance (world units) at which leaf cards start giving way to the
 * canopy hull. Pushed well past the default framing on purpose: the hull is a
 * convincing stand-in only once a tree is small enough on screen that its
 * individual sprigs no longer resolve.
 */
const LEAF_LOD_NEAR = 58;
const LEAF_LOD_FAR = 96;

const LEAF_ALPHA_TEST = 0.42;

/** One tree in the field, repo-backed or not. */
interface FieldTree {
  id: string;
  species: Species;
  variantIndex: number;
  position: [number, number, number];
  scale: number;
  yaw: number;
  foliageTint: THREE.Color | null;
  /** Drives the sprout-in stagger. Filler trees rise last. */
  growthScore: number;
}

interface Bucket {
  key: string;
  species: Species;
  variantIndex: number;
  members: FieldTree[];
  /** Row of the tree-state texture each member reads. */
  stateIndices: number[];
}

export interface TreeFieldProps {
  trees: PlacedTreeData[];
  /** World position of each repo tree's base, keyed by repo id. */
  positions: Map<string, [number, number, number]>;
  onSelect: (id: string) => void;
  hoveredIdRef: React.RefObject<string | null>;
  selectedIdRef: React.RefObject<string | null>;
  foliageDensity: number;
  /** False on the low tier: only the cheap canopy hull is ever drawn. */
  detailedLeaves: boolean;
  reducedMotion: boolean;
  /** How many unlabelled filler trees to grow around the exhibit. */
  decorCount: number;
  decorBounds: DecorBounds;
}

export default function TreeField({
  trees,
  positions,
  onSelect,
  hoveredIdRef,
  selectedIdRef,
  foliageDensity,
  detailedLeaves,
  reducedMotion,
  decorCount,
  decorBounds,
}: TreeFieldProps) {
  // Repo trees first, filler after, so an instance id from the hit proxy (which
  // only covers repo trees) indexes straight into `trees`.
  const field = useMemo<FieldTree[]>(() => {
    const repoTrees: FieldTree[] = trees.map((tree) => {
      const jitter = getTreeJitter(tree.id);
      const world = positions.get(tree.id) ?? [0, 0, 0];
      const build = getSpeciesBuild(tree.species, getVariantIndex(tree.id), foliageDensity);
      return {
        id: tree.id,
        species: tree.species,
        variantIndex: getVariantIndex(tree.id),
        position: world,
        scale: growthToScale(tree.growthScore) * jitter.scaleVariance,
        yaw: jitter.yaw,
        foliageTint: healthyToWilted(build.foliageColor, tree.healthStage),
        growthScore: tree.growthScore,
      };
    });

    const speciesPool = Array.from(new Set(trees.map((tree) => tree.species)));
    // Filler is kept out of a circle sized from each repo tree's own canopy, so
    // the clearing scales with the tree rather than being one fixed radius that
    // is too tight around a large repo and wastefully wide around a small one.
    const clearings = repoTrees.map((tree) => {
      const build = getSpeciesBuild(tree.species, tree.variantIndex, foliageDensity);
      return {
        x: tree.position[0],
        z: tree.position[2],
        radius: Math.max(build.spread * tree.scale * 2.1, 7),
      };
    });
    const decor = buildDecorTrees(
      decorCount,
      decorBounds,
      speciesPool,
      String(trees.length),
      clearings,
    );

    return [
      ...repoTrees,
      ...decor.map((tree) => ({
        id: tree.id,
        species: tree.species,
        variantIndex: tree.variantIndex,
        position: tree.position,
        scale: tree.scale,
        yaw: tree.yaw,
        // Filler trees are always healthy: they carry no data, and wilting one
        // would imply a repo that isn't there.
        foliageTint: null,
        growthScore: 0,
      })),
    ];
  }, [trees, positions, foliageDensity, decorCount, decorBounds]);

  const state = useMemo(() => new TreeStateBuffer(field.length), [field.length]);
  const uniforms = useMemo(() => createTreeUniforms(state), [state]);
  const startTime = useRef<number | null>(null);

  useEffect(() => () => state.dispose(), [state]);

  useEffect(() => {
    setUniform(uniforms.uWindStrength, reducedMotion ? 0 : 1);
  }, [reducedMotion, uniforms]);

  const buckets = useMemo(() => {
    const map = new Map<string, Bucket>();
    field.forEach((tree, index) => {
      const key = `${tree.species}:${tree.variantIndex}`;
      let bucket = map.get(key);
      if (!bucket) {
        bucket = {
          key,
          species: tree.species,
          variantIndex: tree.variantIndex,
          members: [],
          stateIndices: [],
        };
        map.set(key, bucket);
      }
      bucket.members.push(tree);
      bucket.stateIndices.push(index);
    });
    return Array.from(map.values());
  }, [field]);

  const worldPositions = useMemo(
    () => field.map((tree) => new THREE.Vector3(...tree.position)),
    [field],
  );

  useFrame(({ camera, clock }, delta) => {
    if (startTime.current === null) startTime.current = clock.elapsedTime;
    const elapsed = clock.elapsedTime - startTime.current;
    setUniform(uniforms.uTime, clock.elapsedTime);

    const hoveredId = hoveredIdRef.current;
    const selectedId = selectedIdRef.current;

    for (let i = 0; i < field.length; i++) {
      const tree = field[i];
      const distance = camera.position.distanceTo(worldPositions[i]);

      const lodTarget = detailedLeaves ? 1 - smoothstep(LEAF_LOD_NEAR, LEAF_LOD_FAR, distance) : 0;
      const hoverTarget = tree.id === hoveredId ? 1 : 0;
      const selectTarget = tree.id === selectedId ? 1 : 0;

      const hover = reducedMotion
        ? hoverTarget
        : THREE.MathUtils.damp(state.get(i, 0), hoverTarget, 9, delta);
      const select = reducedMotion
        ? selectTarget
        : THREE.MathUtils.damp(state.get(i, 2), selectTarget, 5, delta);
      // The LOD crossfade is always damped, even under reduced motion: it is a
      // level-of-detail transition, not decorative movement, and snapping it
      // would read as the canopy popping.
      const lod = THREE.MathUtils.damp(state.get(i, 3), lodTarget, 6, delta);
      const intro = reducedMotion ? 1 : introProgress(elapsed, tree.growthScore);

      state.set(i, hover, intro, select, lod);
    }

    state.commit();
  });

  useEffect(() => () => setHoverCursor(false), []);

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (event.instanceId === undefined) return;
    event.stopPropagation();
    const tree = trees[event.instanceId];
    if (tree) {
      hoveredIdRef.current = tree.id;
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
    const tree = trees[event.instanceId];
    if (tree) onSelect(tree.id);
  };

  return (
    <group>
      {buckets.map((bucket) => (
        <TreeBucket
          key={bucket.key}
          bucket={bucket}
          uniforms={uniforms}
          foliageDensity={foliageDensity}
          detailedLeaves={detailedLeaves}
        />
      ))}

      <TreeHitProxies
        trees={trees}
        positions={positions}
        foliageDensity={foliageDensity}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      />
    </group>
  );
}

// ---------------------------------------------------------------------------

function TreeBucket({
  bucket,
  uniforms,
  foliageDensity,
  detailedLeaves,
}: {
  bucket: Bucket;
  uniforms: ReturnType<typeof createTreeUniforms>;
  foliageDensity: number;
  detailedLeaves: boolean;
}) {
  const build = useMemo(
    () => getSpeciesBuild(bucket.species, bucket.variantIndex, foliageDensity),
    [bucket.species, bucket.variantIndex, foliageDensity],
  );

  const barkRef = useRef<THREE.InstancedMesh>(null);
  const leafRef = useRef<THREE.InstancedMesh>(null);
  const canopyRef = useRef<THREE.InstancedMesh>(null);

  const materials = useMemo(() => {
    const barkTextures = getBarkTextures(build.barkKind);
    const bark = patchTreeMaterial(
      new THREE.MeshStandardMaterial({
        color: build.barkColor,
        map: barkTextures.map,
        normalMap: barkTextures.normalMap,
        roughnessMap: barkTextures.roughnessMap,
        normalScale: new THREE.Vector2(1.1, 1.1),
        roughness: 1,
        metalness: 0,
      }),
      uniforms,
      "bark",
    );

    const atlas = getLeafAtlas(build.leafShape);
    // alphaTest, never blending: cutout foliage needs depth writes and correct
    // shadows far more than it needs soft edges, and sorting hundreds of
    // thousands of transparent quads is not an option.
    const leaf = patchTreeMaterial(
      new THREE.MeshStandardMaterial({
        map: atlas,
        alphaTest: LEAF_ALPHA_TEST,
        side: THREE.DoubleSide,
        roughness: 0.82,
        metalness: 0,
      }),
      uniforms,
      "leaf",
    );

    const canopy = patchTreeMaterial(
      new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.95,
        metalness: 0,
      }),
      uniforms,
      "canopy",
    );

    return {
      bark,
      leaf,
      canopy,
      barkDepth: createTreeDepthMaterial(uniforms, "bark", null, 0),
      leafDepth: createTreeDepthMaterial(uniforms, "leaf", atlas, LEAF_ALPHA_TEST),
      canopyDepth: createTreeDepthMaterial(uniforms, "canopy", null, 0),
    };
  }, [build, uniforms]);

  useEffect(
    () => () => {
      for (const material of Object.values(materials)) material.dispose();
    },
    [materials],
  );

  useLayoutEffect(() => {
    // One instanced attribute, shared by all three geometries: it maps an
    // instance back to its row in the tree-state texture.
    const treeIndex = new THREE.InstancedBufferAttribute(
      new Float32Array(bucket.stateIndices),
      1,
    );
    build.bark.setAttribute("aTreeIndex", treeIndex);
    build.leaves.setAttribute("aTreeIndex", treeIndex);
    build.canopy.setAttribute("aTreeIndex", treeIndex);

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const axis = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3();
    const position = new THREE.Vector3();

    bucket.members.forEach((tree, index) => {
      position.set(tree.position[0], tree.position[1], tree.position[2]);
      quaternion.setFromAxisAngle(axis, tree.yaw);
      scale.setScalar(tree.scale);
      matrix.compose(position, quaternion, scale);

      for (const mesh of [barkRef.current, leafRef.current, canopyRef.current]) {
        mesh?.setMatrixAt(index, matrix);
      }

      const tint = tree.foliageTint ?? build.foliageColor;
      leafRef.current?.setColorAt(index, tint);
      canopyRef.current?.setColorAt(index, tint);
    });

    for (const mesh of [barkRef.current, leafRef.current, canopyRef.current]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Instance matrices don't feed the geometry's bounding volume, so the
      // default frustum test would use a stale bound centred on the origin and
      // pop the whole bucket out of view. Culling per-bucket buys nothing here
      // anyway -- there are only a handful of meshes.
      mesh.frustumCulled = false;
      // Pointer events all go through the hit proxy; leaving raycast enabled on
      // real foliage would test hundreds of thousands of triangles per mouse move.
      mesh.raycast = () => {};
    }
  }, [build, bucket, detailedLeaves]);

  const count = bucket.members.length;

  return (
    <group>
      <instancedMesh
        ref={barkRef}
        args={[build.bark, materials.bark, count]}
        castShadow
        receiveShadow
        customDepthMaterial={materials.barkDepth}
      />
      {detailedLeaves && (
        <instancedMesh
          ref={leafRef}
          args={[build.leaves, materials.leaf, count]}
          castShadow
          receiveShadow
          customDepthMaterial={materials.leafDepth}
        />
      )}
      {/* No shadow casting. The hull only exists past the LOD threshold, where
          a tree's shadow lands outside the shadow camera's extent or covers a
          couple of pixels inside it -- so casting from it doubles the far
          forest's cost for something nobody can see. */}
      <instancedMesh
        ref={canopyRef}
        args={[build.canopy, materials.canopy, count]}
        receiveShadow
      />
    </group>
  );
}

// ---------------------------------------------------------------------------

/**
 * One invisible, eight-sided cone per *repo* tree, covering trunk and canopy,
 * carrying every pointer event in the scene. Filler trees get none -- they are
 * scenery and must not be clickable.
 *
 * Written with `colorWrite: false` rather than `visible: false` so it is
 * unambiguously present for the raycaster while contributing nothing to the
 * framebuffer or the depth buffer. Sixteen triangles per tree means a pointer
 * move across a hundred-tree forest tests ~1600 triangles, against the millions
 * a raycast on the real foliage would.
 */
function TreeHitProxies({
  trees,
  positions,
  foliageDensity,
  onPointerMove,
  onPointerOut,
  onClick,
}: {
  trees: PlacedTreeData[];
  positions: Map<string, [number, number, number]>;
  foliageDensity: number;
  onPointerMove: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut: () => void;
  onClick: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();

    trees.forEach((tree, index) => {
      const world = positions.get(tree.id) ?? [0, 0, 0];
      const metrics = getTreeMetrics(tree, foliageDensity);
      // Unit cylinder is centred on its own origin, so lift it by half a height.
      position.set(world[0], world[1] + metrics.height / 2, world[2]);
      scale.set(metrics.spread * 1.1, metrics.height, metrics.spread * 1.1);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [trees, positions, foliageDensity]);

  if (trees.length === 0) return null;

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, trees.length]}
      onPointerMove={onPointerMove}
      onPointerOut={onPointerOut}
      onClick={onClick}
    >
      <cylinderGeometry args={[0.62, 0.42, 1, 8, 1, true]} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} />
    </instancedMesh>
  );
}
