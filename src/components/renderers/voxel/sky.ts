import * as THREE from "three";
import { hash2, hash3, lerp, smoothstep } from "./math";
import { buildCloud } from "./island";
import { meshVolume } from "./volume";

/**
 * Sky dome, stars, a cubic sun and moon, the scene's two lights, fog and the
 * cloud ring -- everything that changes between day and night.
 *
 * The theme toggle is an **animation, not a swap**: a single eased `day`
 * factor drives every value here each frame, so flipping dark mode sets the
 * sun, sweeps the shadows round and brings the stars up. Nothing in this file
 * holds a "day" or "night" state of its own.
 *
 * The camera looks *down* at a floating island, so most of what is behind it
 * is the lower half of the dome. That half is therefore not an afterthought
 * "ground" colour: the gradient runs the full sphere and so do the stars.
 */

const DAY = {
  zenith: new THREE.Color("#3f97dd"),
  horizon: new THREE.Color("#f4e2c2"),
  nadir: new THREE.Color("#86c2e8"),
  key: new THREE.Color("#fff0d2"),
  hemiSky: new THREE.Color("#d4ebff"),
  hemiGround: new THREE.Color("#c2a274"),
};
const NIGHT = {
  zenith: new THREE.Color("#0a0f26"),
  horizon: new THREE.Color("#34356e"),
  nadir: new THREE.Color("#141a3e"),
  key: new THREE.Color("#c3d0ff"),
  hemiSky: new THREE.Color("#8d9ad6"),
  hemiGround: new THREE.Color("#4a4468"),
};
const SUNSET = new THREE.Color("#ff8a4c");

export interface Sky {
  /** Live values other systems read by reference (water, particles, glow). */
  state: { horizon: THREE.Color; ambient: THREE.Color; night: number };
  update(day: number, dt: number, cameraPosition: THREE.Vector3): void;
  /** Stars are sized in device pixels. */
  setPixelRatio(ratio: number): void;
  dispose(): void;
}

export function createSky(scene: THREE.Scene, radius: number, cloudCount: number, shadowMapSize: number, cameraAzimuth: number): Sky {
  const disposables: { dispose(): void }[] = [];
  const state = { horizon: new THREE.Color(), ambient: new THREE.Color(), night: 0 };

  const domeMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    uniforms: {
      uZenith: new THREE.Uniform(new THREE.Color()),
      uHorizon: new THREE.Uniform(new THREE.Color()),
      uNadir: new THREE.Uniform(new THREE.Color()),
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = modelViewMatrix * vec4(position, 0.0);
        gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uNadir;
      varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        // Posterised: the sky is banded like everything else here is stepped.
        float t = floor(pow(abs(h), 0.62) * 14.0 + 0.5) / 14.0;
        vec3 c = mix(uHorizon, h > 0.0 ? uZenith : uNadir, t);
        gl_FragColor = vec4(c, 1.0);
      }`,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 24), domeMaterial);
  dome.frustumCulled = false;
  dome.renderOrder = -10;
  scene.add(dome);
  disposables.push(dome.geometry, domeMaterial);

  // Stars: square points over the whole sphere.
  const starCount = 900;
  const starPositions = new Float32Array(starCount * 3);
  const starInfo = new Float32Array(starCount * 2);
  for (let i = 0; i < starCount; i++) {
    const y = hash2(i, 1) * 2 - 1;
    const a = hash2(i, 2) * Math.PI * 2;
    const r = Math.sqrt(1 - y * y);
    starPositions.set([Math.cos(a) * r * 9, y * 9, Math.sin(a) * r * 9], i * 3);
    starInfo.set([hash2(i, 3) < 0.12 ? 3 : hash2(i, 3) < 0.45 ? 2 : 1, hash2(i, 4) * 6.28], i * 2);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  starGeometry.setAttribute("aInfo", new THREE.BufferAttribute(starInfo, 2));
  const starMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    fog: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uNight: new THREE.Uniform(0), uTime: new THREE.Uniform(0), uPixel: new THREE.Uniform(1) },
    vertexShader: /* glsl */ `
      attribute vec2 aInfo; uniform float uTime; uniform float uPixel; varying float vAlpha;
      void main() {
        vec4 p = modelViewMatrix * vec4(position, 0.0);
        gl_Position = projectionMatrix * vec4(p.xyz, 1.0);
        gl_Position.z = gl_Position.w;
        gl_PointSize = aInfo.x * uPixel;
        vAlpha = 0.55 + 0.45 * sin(uTime * (0.6 + aInfo.x * 0.4) + aInfo.y);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight; varying float vAlpha;
      void main() { gl_FragColor = vec4(vec3(1.0, 0.97, 0.9) * 1.3, vAlpha * uNight); }`,
  });
  const stars = new THREE.Points(starGeometry, starMaterial);
  stars.frustumCulled = false;
  stars.renderOrder = -9;
  scene.add(stars);
  disposables.push(starGeometry, starMaterial);

  const sunMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(4.2, 2.9, 1.3), fog: false });
  const moonMaterial = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.9, 2.1, 2.6), fog: false });
  const bodyGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sun = new THREE.Mesh(bodyGeometry, sunMaterial);
  const moon = new THREE.Mesh(bodyGeometry, moonMaterial);
  sun.scale.setScalar(70);
  moon.scale.setScalar(46);
  scene.add(sun, moon);
  disposables.push(bodyGeometry, sunMaterial, moonMaterial);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.castShadow = true;
  key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  const reach = radius * 1.12;
  const cam = key.shadow.camera;
  cam.left = -reach;
  cam.right = reach;
  cam.top = reach;
  cam.bottom = -reach;
  cam.near = 1;
  cam.far = radius * 6;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.35;
  scene.add(hemi, key, key.target);

  scene.fog = new THREE.Fog(0xffffff, radius * 4.5, radius * 17);

  // Clouds: three shapes, instanced round the island on slow orbits.
  const cloudMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
  const cloudGeometries = [1, 2, 3].map((seed) =>
    meshVolume(buildCloud(seed), {
      include: () => true,
      occludes: () => true,
      color: (_id, x, y, z, _f, out) => {
        const k = 0.94 + 0.06 * hash3(x, y, z);
        out[0] = out[1] = out[2] = k;
      },
      aoCurve: [0.72, 0.84, 0.93, 1],
    }),
  );
  disposables.push(cloudMaterial, ...cloudGeometries);
  const clouds: { mesh: THREE.Mesh; orbit: number; angle: number; speed: number }[] = [];
  for (let i = 0; i < cloudCount; i++) {
    const mesh = new THREE.Mesh(cloudGeometries[i % 3], cloudMaterial);
    const scale = 1.1 + hash2(i, 11) * 0.9;
    mesh.scale.setScalar(scale);
    mesh.position.y = lerp(-radius * 1.1, radius * 0.3, hash2(i, 12));
    mesh.rotation.y = hash2(i, 13) * Math.PI;
    scene.add(mesh);
    clouds.push({
      mesh,
      orbit: radius + 40 + hash2(i, 14) * radius * 2.2,
      angle: (i / cloudCount) * Math.PI * 2 + hash2(i, 15),
      speed: (0.006 + hash2(i, 16) * 0.012) * (hash2(i, 17) < 0.5 ? 1 : -1),
    });
  }

  const sunDir = new THREE.Vector3();
  const moonDir = new THREE.Vector3();
  const tmp = new THREE.Color();
  // Three-quarter front light for the default view; the moon sits opposite.
  const sunAzimuth = cameraAzimuth + 1.2;
  const direction = (out: THREE.Vector3, azimuth: number, elevation: number) =>
    out.set(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation));
  let time = 0;

  return {
    state,
    update(day, dt, cameraPosition) {
      time += dt;
      const dusk = Math.pow(4 * day * (1 - day), 1.5);
      domeMaterial.uniforms.uZenith.value.copy(NIGHT.zenith).lerp(DAY.zenith, day);
      domeMaterial.uniforms.uNadir.value.copy(NIGHT.nadir).lerp(DAY.nadir, day);
      state.horizon.copy(NIGHT.horizon).lerp(DAY.horizon, day).lerp(SUNSET, dusk * 0.7);
      domeMaterial.uniforms.uHorizon.value.copy(state.horizon);
      state.night = 1 - day;
      state.ambient.setRGB(lerp(0.42, 1, day), lerp(0.5, 1, day), lerp(0.74, 1, day));

      dome.position.copy(cameraPosition);
      stars.position.copy(cameraPosition);
      starMaterial.uniforms.uNight.value = smoothstep(0.55, 0.1, day);
      starMaterial.uniforms.uTime.value = time;

      direction(sunDir, sunAzimuth, lerp(-0.5, 0.74, day));
      direction(moonDir, sunAzimuth + Math.PI - 0.5, lerp(0.86, -0.5, day));
      sun.position.copy(cameraPosition).addScaledVector(sunDir, 1500);
      moon.position.copy(cameraPosition).addScaledVector(moonDir, 1500);

      const useSun = day > 0.5;
      const strength = useSun ? smoothstep(0.5, 0.85, day) : smoothstep(0.5, 0.15, day);
      key.color.copy(useSun ? DAY.key : NIGHT.key);
      if (useSun) key.color.lerp(SUNSET, dusk * 0.6);
      key.intensity = (useSun ? 2.5 : 1.5) * strength;
      key.position.copy(useSun ? sunDir : moonDir).multiplyScalar(radius * 3);
      key.target.position.set(0, 0, 0);

      hemi.color.copy(NIGHT.hemiSky).lerp(DAY.hemiSky, day);
      hemi.groundColor.copy(NIGHT.hemiGround).lerp(DAY.hemiGround, day);
      hemi.intensity = lerp(1.45, 1.35, day);

      (scene.fog as THREE.Fog).color.copy(state.horizon);
      tmp.setRGB(lerp(0.1, 0.34, day), lerp(0.11, 0.34, day), lerp(0.2, 0.36, day));
      cloudMaterial.emissive.copy(tmp);

      for (const cloud of clouds) {
        cloud.angle += cloud.speed * dt;
        cloud.mesh.position.x = Math.cos(cloud.angle) * cloud.orbit;
        cloud.mesh.position.z = Math.sin(cloud.angle) * cloud.orbit;
      }
    },
    setPixelRatio(ratio) {
      starMaterial.uniforms.uPixel.value = ratio;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      key.shadow.map?.dispose();
    },
  };
}
