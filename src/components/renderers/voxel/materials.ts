import * as THREE from "three";

/**
 * The one lit material every voxel mesh uses, and the uniforms it shares.
 *
 * It is `MeshLambertMaterial` with three things patched in:
 *
 *  - **Baked lantern light.** `aGlow` is a per-vertex point-light term computed
 *    at build time. It costs nothing at runtime and is what turns night from
 *    "the same scene, darker" into warm pools along the walk -- real point
 *    lights with shadows for a few dozen lanterns would cost more than the
 *    rest of the frame.
 *  - **Voxel-by-voxel growth.** Animated meshes carry each voxel's centre and
 *    birth time; a voxel scales up from its own centre as the shared `uGrow`
 *    clock passes its birth. Trees assemble like a build animation, trunk
 *    first, and the CPU does nothing per frame for it.
 *  - **Leaf flutter**, displaced per *voxel* rather than per vertex, so cubes
 *    stay cubes.
 *
 * The same vertex patch goes into the depth material, otherwise a tree's full
 * shadow lies on the ground while the tree itself is still two voxels tall.
 */
export const shared = {
  uTime: new THREE.Uniform(0),
  uGrow: new THREE.Uniform(0),
  uNight: new THREE.Uniform(0),
  uWind: new THREE.Uniform(1),
};

const VERT_HEAD = /* glsl */ `
attribute float aGlow;
varying float vGlow;
#ifdef VOXEL_ANIMATED
attribute vec3 aCenter;
attribute vec2 aInfo;
uniform float uGrow;
uniform float uTime;
uniform float uWind;
#endif
`;

const VERT_BODY = /* glsl */ `
vec3 transformed = vec3(position);
vGlow = aGlow;
#ifdef VOXEL_ANIMATED
{
  float k = clamp((uGrow - aInfo.x) / 0.035, 0.0, 1.0);
  float u = k - 1.0;
  k = 1.0 + 2.6 * u * u * u + 1.6 * u * u; // easeOutBack: each voxel pops slightly past full size
  vec3 c = aCenter;
  float sway = aInfo.y * uWind;
  c.x += sin(uTime * 1.7 + aCenter.y * 0.55 + aCenter.z * 0.4) * 0.07 * sway;
  c.y += sin(uTime * 2.3 + aCenter.x * 0.7 + aCenter.z * 0.6) * 0.05 * sway;
  transformed = c + (transformed - aCenter) * k;
}
#endif
`;

function patchVertex(shader: { vertexShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace("#include <common>", `#include <common>\n${VERT_HEAD}`)
    .replace("#include <begin_vertex>", VERT_BODY);
}

export interface VoxelMaterialOptions {
  animated?: boolean;
  /** Per-mesh hover highlight, 0..1. */
  hover?: THREE.Uniform<number>;
}

export function createVoxelMaterial(opts: VoxelMaterialOptions = {}): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (opts.animated) material.defines = { VOXEL_ANIMATED: "" };
  const hover = opts.hover ?? new THREE.Uniform(0);
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uGrow = shared.uGrow;
    shader.uniforms.uWind = shared.uWind;
    shader.uniforms.uNight = shared.uNight;
    shader.uniforms.uHover = hover;
    patchVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGlow;\nuniform float uNight;\nuniform float uHover;")
      .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + uHover * 0.3;")
      .replace(
        "#include <opaque_fragment>",
        "outgoingLight += diffuseColor.rgb * vGlow * uNight * vec3(1.0, 0.56, 0.2) * 2.4;\noutgoingLight += diffuseColor.rgb * uHover * 0.12;\n#include <opaque_fragment>",
      );
  };
  material.customProgramCacheKey = () => (opts.animated ? "voxel-animated" : "voxel-static");
  return material;
}

let depthMaterial: THREE.MeshDepthMaterial | null = null;

/** Shadow-pass material matching the animated vertex patch. One instance serves every tree. */
export function animatedDepthMaterial(): THREE.MeshDepthMaterial {
  if (depthMaterial) return depthMaterial;
  const material = new THREE.MeshDepthMaterial();
  material.defines = { VOXEL_ANIMATED: "" };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uGrow = shared.uGrow;
    shader.uniforms.uWind = shared.uWind;
    patchVertex(shader);
    shader.vertexShader = shader.vertexShader.replace("vGlow = aGlow;", "").replace("attribute float aGlow;\nvarying float vGlow;", "");
  };
  material.customProgramCacheKey = () => "voxel-depth";
  depthMaterial = material;
  return material;
}
