import * as THREE from "three";
import { shared } from "./materials";

/**
 * Every loose cube in the air: petals, falling leaves, waterfall spray,
 * chimney smoke, pollen by day and fireflies by night.
 *
 * One InstancedMesh, one draw call, and no per-frame CPU work at all -- each
 * particle is a closed-form loop evaluated in the vertex shader from its
 * origin, a travel vector and a phase. They are cubes, not sprites, for the
 * same reason the sun is a cube.
 */

export const KIND_LIT = 0;
/** Glows, and only exists at night. */
export const KIND_FIREFLY = 1;
/** Only exists by day. */
export const KIND_DAY = 2;
/** Always glows: the marker pulsing over each repo tree. */
export const KIND_BEACON = 3;

export interface ParticleSpec {
  origin: [number, number, number];
  /** Total displacement over one loop. */
  travel: [number, number, number];
  period: number;
  size: number;
  /** Sideways wander amplitude. */
  sway: number;
  color: [number, number, number];
  kind: number;
}

export function createParticles(specs: ParticleSpec[], ambient: THREE.Color): THREE.Mesh | null {
  if (specs.length === 0) return null;
  const count = specs.length;
  const origin = new Float32Array(count * 3);
  const travel = new Float32Array(count * 3);
  const params = new Float32Array(count * 4);
  const color = new Float32Array(count * 4);
  specs.forEach((s, i) => {
    origin.set(s.origin, i * 3);
    travel.set(s.travel, i * 3);
    // Golden-ratio phases: evenly spread, never in step.
    params.set([(i * 0.618034) % 1, s.period, s.size, s.sway], i * 4);
    color.set([...s.color, s.kind], i * 4);
  });
  const geometry = new THREE.InstancedBufferGeometry();
  const box = new THREE.BoxGeometry(1, 1, 1);
  geometry.index = box.index;
  geometry.setAttribute("position", box.getAttribute("position"));
  geometry.setAttribute("normal", box.getAttribute("normal"));
  geometry.setAttribute("aOrigin", new THREE.InstancedBufferAttribute(origin, 3));
  geometry.setAttribute("aTravel", new THREE.InstancedBufferAttribute(travel, 3));
  geometry.setAttribute("aParams", new THREE.InstancedBufferAttribute(params, 4));
  geometry.setAttribute("aColor", new THREE.InstancedBufferAttribute(color, 4));
  geometry.instanceCount = count;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uNight: shared.uNight,
      uMotion: new THREE.Uniform(1),
      uAmbient: new THREE.Uniform(ambient),
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOrigin; attribute vec3 aTravel; attribute vec4 aParams; attribute vec4 aColor;
      uniform float uTime; uniform float uNight; uniform float uMotion;
      varying vec3 vColor; varying float vShade; varying float vKind;
      void main() {
        float kind = aColor.a;
        // Under reduced motion every particle settles at a fixed point of its loop rather than freezing mid-air.
        float u = fract(aParams.x + uMotion * uTime / aParams.y);
        float life = sin(3.14159 * u);
        float presence = kind < 0.5 || kind > 2.5 ? 1.0 : kind < 1.5 ? smoothstep(0.45, 0.85, uNight) : smoothstep(0.55, 0.15, uNight);
        float blink = kind > 0.5 && kind < 1.5 ? 0.55 + 0.45 * sin(uTime * 2.4 + aParams.x * 40.0) : 1.0;
        vec3 c = aOrigin + aTravel * u;
        float w = uTime * uMotion * 0.9 + aParams.x * 31.0;
        c += vec3(sin(w), sin(w * 0.7 + 1.3) * 0.5, cos(w * 0.8)) * aParams.w;
        float s = aParams.z * sqrt(life) * presence;
        // Spin about the fall axis, so a petal shows more than one face on the way down.
        float a = kind > 2.5 ? 0.0 : w * 1.7; float ca = cos(a); float sa = sin(a);
        vec3 p = position * s;
        p.xz = mat2(ca, -sa, sa, ca) * p.xz;
        vShade = 0.72 + 0.28 * dot(normalize(normal), normalize(vec3(0.3, 1.0, 0.4)));
        vColor = aColor.rgb * blink;
        vKind = kind;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(c + p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uAmbient; uniform float uNight;
      varying vec3 vColor; varying float vShade; varying float vKind;
      void main() {
        vec3 c = vKind > 2.5 ? vColor * vShade * mix(1.0, 1.9, uNight) : vKind > 0.5 && vKind < 1.5 ? vColor * 4.0 : vColor * vShade * uAmbient;
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.box = box;
  return mesh;
}
