"use client";

import * as THREE from "three";
import type { TreeStateBuffer } from "./treeState";

/**
 * Shader injection that makes every tree animate on the GPU.
 *
 * Bark, leaf cards and the far-LOD canopy hull are each one InstancedMesh per
 * (species, variant) bucket, with one instance per tree and a *static* instance
 * matrix. Nothing is recomposed on the CPU per frame. Instead the vertex stage
 * looks the tree's animation state up out of `TreeStateBuffer`'s texture by the
 * instanced `aTreeIndex` attribute, and applies:
 *
 *   - sprout-in and hover pop, as a uniform scale about the tree's base;
 *   - the LOD gate, which collapses whichever foliage representation is not
 *     currently wanted to zero size (degenerate triangles cost no fill);
 *   - wind sway, bending with the square of local height so the crown moves
 *     and the base does not;
 *   - per-card flutter on leaves only, keyed to a phase baked per card.
 *
 * All three part types run the identical sway expression off the identical
 * state texel, which is what keeps bark and foliage welded together -- the old
 * renderer computed them in two places and they could drift.
 */

export type TreePart = "bark" | "leaf" | "canopy";

export interface TreeUniforms {
  uTime: THREE.IUniform<number>;
  uTreeState: THREE.IUniform<THREE.Texture>;
  uTreeCount: THREE.IUniform<number>;
  uWindDir: THREE.IUniform<THREE.Vector2>;
  uWindStrength: THREE.IUniform<number>;
  uGlowColor: THREE.IUniform<THREE.Color>;
}

/**
 * `THREE.Uniform` instances rather than `{ value: x }` literals, deliberately:
 * the React Compiler's dev runtime deep-freezes plain objects returned from
 * render, which would silently turn every per-frame uniform write into a no-op.
 * See `imperative.ts`.
 */
export function createTreeUniforms(state: TreeStateBuffer): TreeUniforms {
  return {
    uTime: new THREE.Uniform(0),
    uTreeState: new THREE.Uniform(state.texture),
    uTreeCount: new THREE.Uniform(state.count),
    uWindDir: new THREE.Uniform(new THREE.Vector2(0.82, 0.57).normalize()),
    uWindStrength: new THREE.Uniform(1),
    uGlowColor: new THREE.Uniform(new THREE.Color("#ffc978")),
  };
}

const VERTEX_DECLARATIONS = /* glsl */ `
uniform float uTime;
uniform sampler2D uTreeState;
uniform float uTreeCount;
uniform vec2 uWindDir;
uniform float uWindStrength;
attribute float aTreeIndex;
#ifdef TREE_LEAF
attribute float aPhase;
#endif
#ifndef TREE_DEPTH
varying float vTreeHover;
varying float vTreeSelect;
#endif
`;

const VERTEX_DISPLACEMENT = /* glsl */ `
vec4 treeState = texture2D(uTreeState, vec2((aTreeIndex + 0.5) / uTreeCount, 0.5));
float tHover = treeState.r;
float tIntro = treeState.g;
float tSelect = treeState.b;
float tLod = treeState.a;

#ifndef TREE_DEPTH
  vTreeHover = tHover;
  vTreeSelect = tSelect;
#endif

// Whichever foliage representation is not wanted at this distance collapses to
// a point. Cheaper and pop-free compared to toggling object visibility, and it
// keeps the instance count of both meshes constant.
#if defined(TREE_LEAF)
  float lodGate = tLod;
#elif defined(TREE_CANOPY)
  float lodGate = 1.0 - tLod;
#else
  float lodGate = 1.0;
#endif

float grow = tIntro * (1.0 + tHover * TREE_HOVER_POP) * lodGate;
transformed *= grow;

// Per-tree sway phase, derived from the index rather than another attribute --
// deterministic, free, and identical in every part type.
float treePhase = fract(sin(aTreeIndex * 12.9898) * 43758.5453) * 6.2831853;
float localHeight = max(transformed.y, 0.0);
float sway =
  sin(uTime * 0.85 + treePhase) * 0.66 +
  sin(uTime * 1.73 + treePhase * 1.7) * 0.34;
transformed.xz += uWindDir * (uWindStrength * TREE_WIND_SCALE * localHeight * localHeight * sway);

#ifdef TREE_LEAF
  float flutter =
    sin(uTime * 3.9 + aPhase) * 0.6 +
    sin(uTime * 6.3 + aPhase * 2.1) * 0.4;
  transformed += vec3(uWindDir.x, 0.42, uWindDir.y) *
    (flutter * uWindStrength * TREE_LEAF_FLUTTER * lodGate);
#endif
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
uniform vec3 uGlowColor;
varying float vTreeHover;
varying float vTreeSelect;
`;

// Hover reads as the tree lighting up from within; selection is stronger and
// steadier. Added to emissive (not to the final color) so the bloom pass picks
// it up and so it still respects tone mapping.
const FRAGMENT_GLOW = /* glsl */ `
totalEmissiveRadiance += uGlowColor * (vTreeHover * 0.5 + vTreeSelect * 0.9);
`;

const PART_DEFINES: Record<TreePart, Record<string, string>> = {
  bark: { TREE_BARK: "1", TREE_WIND_SCALE: "0.0016", TREE_HOVER_POP: "0.05" },
  leaf: {
    TREE_LEAF: "1",
    TREE_WIND_SCALE: "0.0026",
    TREE_HOVER_POP: "0.08",
    TREE_LEAF_FLUTTER: "0.05",
  },
  canopy: { TREE_CANOPY: "1", TREE_WIND_SCALE: "0.0024", TREE_HOVER_POP: "0.08" },
};

/**
 * Wire a standard material into the tree animation system. Returns the same
 * material for chaining. Safe to call on any material whose shader includes the
 * stock `common` / `begin_vertex` chunks.
 */
export function patchTreeMaterial<T extends THREE.Material>(
  material: T,
  uniforms: TreeUniforms,
  part: TreePart,
  options: { depth?: boolean } = {},
): T {
  const defines: Record<string, string> = { ...PART_DEFINES[part] };
  if (options.depth) defines.TREE_DEPTH = "1";

  material.defines = { ...(material.defines ?? {}), ...defines };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uTreeState = uniforms.uTreeState;
    shader.uniforms.uTreeCount = uniforms.uTreeCount;
    shader.uniforms.uWindDir = uniforms.uWindDir;
    shader.uniforms.uWindStrength = uniforms.uWindStrength;

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${VERTEX_DECLARATIONS}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${VERTEX_DISPLACEMENT}`);

    if (!options.depth) {
      shader.uniforms.uGlowColor = uniforms.uGlowColor;
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", `#include <common>\n${FRAGMENT_DECLARATIONS}`)
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>\n${FRAGMENT_GLOW}`,
        );
    }
  };

  // Distinct cache key per part+stage, so three never hands a bark program to a
  // leaf material just because both derive from MeshStandardMaterial.
  material.customProgramCacheKey = () => `tree-${part}${options.depth ? "-depth" : ""}`;

  return material;
}

/**
 * Shadow-pass twin of a foliage material. Without this, leaf cards would cast
 * rectangular shadows (the depth pass ignores alphaTest maps it wasn't given)
 * and would not sway in shadow, which reads as the shadow sliding off the tree.
 */
export function createTreeDepthMaterial(
  uniforms: TreeUniforms,
  part: TreePart,
  map: THREE.Texture | null,
  alphaTest: number,
): THREE.MeshDepthMaterial {
  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    alphaTest,
    side: THREE.DoubleSide,
  });
  // The depth pass runs `map_fragment` before `alphatest_fragment`, so handing
  // it the same atlas is what makes the cutout shape reach the shadow map.
  if (map) material.map = map;
  return patchTreeMaterial(material, uniforms, part, { depth: true });
}
