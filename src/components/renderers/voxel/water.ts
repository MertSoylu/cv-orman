import * as THREE from "three";
import { shared } from "./materials";
import type { Island } from "./island";

/**
 * The pond, the stream and the fall off the island's edge.
 *
 * The surface is the island's own water voxels, meshed like everything else,
 * drawn with a shader that sparkles in **half-voxel pixels** -- quantised in
 * space and stepped in time, so the water animates the way a sprite does. A
 * smooth, physically minded ripple here is the fastest way to make the rest
 * of the scene look like it belongs to a different game.
 *
 * The fall is a ribbon that dissolves on the way down by discarding whole
 * pixels against a hash, so it thins into droplets rather than fading.
 */

const HASH = /* glsl */ `
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

export function createWaterMaterial(ambient: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    uniforms: { uTime: shared.uTime, uAmbient: new THREE.Uniform(ambient) },
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying vec3 vN;
      void main() {
        vec3 p = position;
        p.y -= 0.28;
        vWorld = p; vN = normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uAmbient;
      varying vec3 vWorld; varying vec3 vN;
      ${HASH}
      void main() {
        vec3 shallow = vec3(0.16, 0.56, 0.72);
        vec3 deep = vec3(0.07, 0.33, 0.55);
        vec3 c;
        if (vN.y > 0.5) {
          vec2 cell = floor(vWorld.xz * 2.0);
          float tick = floor(uTime * 2.2 + hash(cell) * 5.0);
          float sparkle = step(0.9, hash(cell + tick * 0.37));
          float band = step(0.72, hash(floor(vWorld.xz * 0.9) + floor(uTime * 0.7)));
          c = mix(deep, shallow, 0.55 + 0.3 * band) + sparkle * 0.5;
        } else {
          // The little cascades between levels: white water, scrolling down.
          vec2 cell = floor(vec2((vWorld.x + vWorld.z) * 2.0, vWorld.y * 3.0 + uTime * 7.0));
          c = mix(shallow, vec3(0.92, 0.97, 1.0), 0.35 + 0.5 * step(0.5, hash(cell)));
        }
        gl_FragColor = vec4(c * uAmbient, 0.86);
      }`,
  });
}

/** A U-shaped ribbon hanging off the island where the stream leaves it. */
export function createWaterfall(fall: NonNullable<Island["waterfall"]>, height: number, ambient: THREE.Color): THREE.Mesh {
  const px = -fall.dz;
  const pz = fall.dx;
  const corners: [number, number][] = [
    [fall.x - px * 1.5 - fall.dx * 0.4, fall.z - pz * 1.5 - fall.dz * 0.4],
    [fall.x - px * 1.5 + fall.dx * 1.1, fall.z - pz * 1.5 + fall.dz * 1.1],
    [fall.x + px * 1.5 + fall.dx * 1.1, fall.z + pz * 1.5 + fall.dz * 1.1],
    [fall.x + px * 1.5 - fall.dx * 0.4, fall.z + pz * 1.5 - fall.dz * 0.4],
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const top = fall.y - 0.28;
  let u = 0;
  for (let i = 0; i < 3; i++) {
    const [ax, az] = corners[i];
    const [bx, bz] = corners[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const base = positions.length / 3;
    positions.push(ax, top, az, bx, top, bz, bx, top - height, bz, ax, top - height, az);
    uvs.push(u, 0, u + len, 0, u + len, height, u, height);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    u += len;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uTime: shared.uTime, uAmbient: new THREE.Uniform(ambient), uHeight: new THREE.Uniform(height) },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uAmbient; uniform float uHeight;
      varying vec2 vUv;
      ${HASH}
      void main() {
        float fallen = vUv.y - uTime * 15.0;
        vec2 cell = floor(vec2(vUv.x * 2.0, fallen * 0.45));
        vec2 pixel = floor(vec2(vUv.x * 2.0, fallen * 2.0));
        float keep = 1.0 - smoothstep(uHeight * 0.12, uHeight, vUv.y);
        if (hash(pixel) > keep * 1.15) discard;
        vec3 c = mix(vec3(0.2, 0.6, 0.78), vec3(0.93, 0.98, 1.0), step(0.45, hash(cell)));
        gl_FragColor = vec4(c * uAmbient, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  return mesh;
}
