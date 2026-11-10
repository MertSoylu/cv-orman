import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from "postprocessing";
import type { PlacedTreeData } from "@/lib/forest/treeData";
import type { QualityPreset } from "@/hooks/useQualityTier";
import { clamp, hash2, lerp, seededRandom, smoothstep } from "./math";
import { meshVolume } from "./volume";
import { animatedDepthMaterial, createVoxelMaterial, shared } from "./materials";
import { buildIsland, buildIslet, isEmissive, isWater, terrainColor, type Island } from "./island";
import { LEAF, buildTree } from "./trees";
import { createSky, type Sky } from "./sky";
import { createWaterMaterial, createWaterfall } from "./water";
import { KIND_DAY, KIND_FIREFLY, KIND_LIT, createParticles, type ParticleSpec } from "./particles";
import { createLabel, type Label } from "./labels";

/**
 * The voxel world: a plain three.js engine with no React in it.
 *
 * The scene is a long-lived, imperatively-driven object graph -- exactly the
 * thing React's model (and its compiler's freezing of memoised values) fights.
 * So React owns one `<div>` and four prop changes (`setDark`, `setSelected`,
 * `setReducedMotion`, `dispose`), and everything else lives here, where a
 * frame loop can just write to things.
 *
 * Per frame the CPU does almost nothing: a handful of uniforms, one easing
 * value per tree, and the label fades. Growth, leaf flutter, water, every
 * particle and the star field are all closed-form in shaders.
 */

export interface WorldOptions {
  trees: PlacedTreeData[];
  isDark: boolean;
  reducedMotion: boolean;
  quality: QualityPreset;
  onSelect: (id: string) => void;
  onReady: () => void;
}

export interface World {
  setDark(isDark: boolean): void;
  setSelected(id: string | null): void;
  setReducedMotion(reduced: boolean): void;
  dispose(): void;
}

const FOV = 32;
/** Camera's resting compass angle. The stream and its fall run toward the viewer's right. */
const HOME_AZIMUTH = 0.5;
const HOME_ELEVATION = 0.5;
const HEALTH_RAMP = ["#6fae4f", "#a9b84a", "#d9a441", "#c8762b", "#8a5a2b"];
/** Seconds a frame may average before the governor gives something up. */
const SLOW_FRAME = 1 / 28;

interface TreeEntry {
  data: PlacedTreeData;
  mesh: THREE.Mesh;
  hover: THREE.Uniform<number>;
  box: THREE.Box3;
  base: number;
  height: number;
  label: Label;
  /** When, on the shared growth clock, this tree has finished assembling. */
  grownAt: number;
  ease: number;
}

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export function createWorld(container: HTMLElement, options: WorldOptions): World {
  const { trees, quality } = options;
  let disposed = false;
  let reducedMotion = options.reducedMotion;
  let dayTarget = options.isDark ? 0 : 1;
  let dayRaw = dayTarget;
  let selectedId: string | null = null;

  // Throws if WebGL is unavailable; the React wrapper turns that into the fallback list.
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance", stencil: false });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  const canvas = renderer.domElement;
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none;outline:none";
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 5000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.6;
  controls.zoomSpeed = 0.9;
  controls.minPolarAngle = 0.18;
  controls.maxPolarAngle = 2.0; // past the horizon: you can look up at the crystals underneath
  controls.autoRotateSpeed = 0.35;

  shared.uTime.value = 0;
  shared.uGrow.value = reducedMotion ? 2 : 0;
  shared.uWind.value = reducedMotion ? 0 : 1;

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: quality.multisampling });
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1, luminanceSmoothing: 0.25, intensity: 0.8, radius: 0.7 });
  const effects = [
    ...(quality.bloom ? [bloom] : []),
    new VignetteEffect({ offset: 0.32, darkness: 0.42 }),
    // Linear on purpose: a filmic curve re-grades the palette, and in voxel art the palette *is* the picture.
    new ToneMappingEffect({ mode: ToneMappingMode.LINEAR }),
  ];
  let bloomOn = quality.bloom;
  let effectPass = new EffectPass(camera, ...effects);
  composer.addPass(effectPass);

  const disposables: { dispose(): void }[] = [];
  const entries: TreeEntry[] = [];
  const byId = new Map<string, TreeEntry>();
  let island: Island | null = null;
  let sky: Sky | null = null;
  let glowMaterial: THREE.MeshBasicMaterial | null = null;
  let particles: THREE.Mesh | null = null;
  const islets: { mesh: THREE.Mesh; y: number; phase: number }[] = [];
  let ready = false;

  // --- Camera state ----------------------------------------------------------------------------
  const home = { position: new THREE.Vector3(), target: new THREE.Vector3(), distance: 100 };
  let saved: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;
  const flight = { active: false, t: 0, duration: 1.2, fromP: new THREE.Vector3(), fromT: new THREE.Vector3(), toP: new THREE.Vector3(), toT: new THREE.Vector3() };
  let viewShift = 0;
  let interactedAt = -Infinity;
  let clock = 0;
  let width = 1;
  let height = 1;
  let renderScale = 1;

  const computeHome = () => {
    if (!island) return;
    const top = island.summit + 24;
    const extent = Math.max(island.radius * 1.04, (top - island.bottom) * 0.62);
    const aspect = width / height;
    home.distance = (extent * 0.8) / (Math.sin(THREE.MathUtils.degToRad(FOV / 2)) * Math.min(1, aspect * 0.92));
    home.target.set(0, lerp(island.bottom, top, 0.6), 0);
    home.position.set(
      Math.cos(HOME_AZIMUTH) * Math.cos(HOME_ELEVATION),
      Math.sin(HOME_ELEVATION),
      Math.sin(HOME_AZIMUTH) * Math.cos(HOME_ELEVATION),
    ).multiplyScalar(home.distance).add(home.target);
    controls.minDistance = 16;
    controls.maxDistance = home.distance * 1.7;
  };

  const flyTo = (position: THREE.Vector3, target: THREE.Vector3) => {
    if (reducedMotion) {
      camera.position.copy(position);
      controls.target.copy(target);
      return;
    }
    flight.active = true;
    flight.t = 0;
    flight.fromP.copy(camera.position);
    flight.fromT.copy(controls.target);
    flight.toP.copy(position);
    flight.toT.copy(target);
    flight.duration = clamp(camera.position.distanceTo(position) / 140, 0.9, 1.7);
  };

  // --- Picking ---------------------------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const hit = new THREE.Vector3();
  let pointerInside = false;
  let pointerDirty = false;
  let hoveredId: string | null = null;
  const down = { x: 0, y: 0, time: 0 };

  const pick = (): string | null => {
    raycaster.setFromCamera(pointer, camera);
    let best: string | null = null;
    let bestDistance = Infinity;
    for (const entry of entries) {
      if (shared.uGrow.value < entry.grownAt - 0.3) continue;
      if (!raycaster.ray.intersectBox(entry.box, hit)) continue;
      const d = hit.distanceToSquared(raycaster.ray.origin);
      if (d < bestDistance) {
        bestDistance = d;
        best = entry.data.id;
      }
    }
    return best;
  };
  const setPointer = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  };
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    setPointer(event);
    pointerInside = true;
    pointerDirty = true;
  };
  const onPointerLeave = () => {
    pointerInside = false;
    pointerDirty = true;
  };
  const onPointerDown = (event: PointerEvent) => {
    down.x = event.clientX;
    down.y = event.clientY;
    down.time = performance.now();
  };
  const onPointerUp = (event: PointerEvent) => {
    // A click is a press that did not turn into a drag.
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 7 || performance.now() - down.time > 600) return;
    setPointer(event);
    const id = pick();
    if (id) options.onSelect(id);
  };
  const onControlStart = () => {
    interactedAt = clock;
    flight.active = false;
  };
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  controls.addEventListener("start", onControlStart);

  const hoverBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color("#fff6e8"));
  const selectBox = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color("#e0764f"));
  hoverBox.visible = selectBox.visible = false;
  scene.add(hoverBox, selectBox);

  // --- Sizing ----------------------------------------------------------------------------------
  const applySize = () => {
    width = Math.max(1, container.clientWidth);
    height = Math.max(1, container.clientHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, quality.dprMax) * renderScale;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    sky?.setPixelRatio(Math.max(1, ratio));
    const wasHome = ready && !saved && interactedAt === -Infinity;
    computeHome();
    if (wasHome && !flight.active) {
      camera.position.copy(home.position);
      controls.target.copy(home.target);
    }
  };
  const resizeObserver = new ResizeObserver(applySize);
  resizeObserver.observe(container);
  let onScreen = true;
  const intersectionObserver = new IntersectionObserver(([entry]) => (onScreen = entry.isIntersecting));
  intersectionObserver.observe(container);

  // --- Build, spread over frames so the page keeps answering while it happens ----------------------
  const build = async () => {
    await nextFrame();
    if (disposed) return;
    const built = buildIsland(trees.map((t) => ({ id: t.id, x: t.x, z: t.y, healthStage: t.healthStage })), quality.decorDensity);
    island = built;
    const solid = (id: number) => !isWater(id) && !isEmissive(id);
    await nextFrame();
    if (disposed) return;

    const staticMaterial = createVoxelMaterial();
    const ground = new THREE.Mesh(
      meshVolume(built.volume, { include: solid, occludes: solid, color: terrainColor, light: built.lightAt }),
      staticMaterial,
    );
    ground.castShadow = ground.receiveShadow = true;
    scene.add(ground);
    disposables.push(ground.geometry, staticMaterial);

    glowMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
    const glow = new THREE.Mesh(
      meshVolume(built.volume, { include: isEmissive, occludes: (id) => !isWater(id), color: terrainColor, aoCurve: [1, 1, 1, 1] }),
      glowMaterial,
    );
    scene.add(glow);
    disposables.push(glow.geometry, glowMaterial);

    sky = createSky(scene, built.radius, quality.clouds, quality.shadowMapSize, HOME_AZIMUTH);
    disposables.push(sky);

    const waterMaterial = createWaterMaterial(sky.state.ambient);
    const water = new THREE.Mesh(
      meshVolume(built.volume, { include: isWater, occludes: (id) => id !== 0, color: (_i, _x, _y, _z, _f, out) => void (out[0] = out[1] = out[2] = 1) }),
      waterMaterial,
    );
    water.renderOrder = 2;
    scene.add(water);
    disposables.push(water.geometry, waterMaterial);
    const fallHeight = Math.min(70, built.radius * 1.3);
    if (built.waterfall) {
      const fall = createWaterfall(built.waterfall, fallHeight, sky.state.ambient);
      scene.add(fall);
      disposables.push(fall.geometry, fall.material as THREE.Material);
    }
    await nextFrame();
    if (disposed) return;

    // Trees grow in from the summit outward: the oldest repo first, the newest last.
    const order = [...trees].sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y));
    const specs: ParticleSpec[] = [];
    const rng = seededRandom("particles");
    const depthMaterial = animatedDepthMaterial();
    for (let i = 0; i < order.length; i++) {
      const data = order[i];
      const model = buildTree(data.id, data.species, data.growthScore, data.healthStage);
      const base = built.treeBase.get(data.id) ?? 0;
      const birthOffset = order.length > 1 ? 0.55 * (i / (order.length - 1)) : 0;
      const geometry = meshVolume(model.volume, {
        include: () => true,
        occludes: () => true,
        color: model.color,
        animated: { birthOffset, birthSpan: 0.4, flag: (id) => (id === LEAF ? 1 : 0) },
        light: (x, y, z) => built.lightAt(x + data.x, y + base, z + data.y),
      });
      const hover = new THREE.Uniform(0);
      const material = createVoxelMaterial({ animated: true, hover });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(data.x, base, data.y);
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.customDepthMaterial = depthMaterial;
      mesh.frustumCulled = false; // growth and flutter move vertices outside the static bounds
      scene.add(mesh);
      disposables.push(geometry, material);

      const v = model.volume;
      const box = new THREE.Box3(
        new THREE.Vector3(data.x + v.ox - 0.3, base, data.y + v.oz - 0.3),
        new THREE.Vector3(data.x + v.ox + v.sx + 0.3, base + v.sy + 0.3, data.y + v.oz + v.sz + 0.3),
      );
      const tier = clamp(Math.floor(((1 - data.healthStage) / 0.85) * 4.99), 0, 4);
      const label = createLabel(data.name, HEALTH_RAMP[tier]);
      label.sprite.position.set(data.x + 0.5, base + model.height + 1.6, data.y + 0.5);
      scene.add(label.sprite);
      disposables.push(label.sprite.material, label.sprite.material.map as THREE.Texture);

      const entry: TreeEntry = { data, mesh, hover, box, base, height: model.height, label, grownAt: birthOffset + 0.42, ease: 0 };
      entries.push(entry);
      byId.set(data.id, entry);

      const falling = Math.round(model.dropRate * 11 * quality.particles);
      for (let k = 0; k < falling && model.leafSamples.length > 0; k++) {
        const s = model.leafSamples[Math.floor(rng() * model.leafSamples.length)];
        specs.push({
          origin: [data.x + s[0], base + s[1], data.y + s[2]],
          travel: [(rng() - 0.5) * 4, -s[1] + 0.2, (rng() - 0.5) * 4],
          period: 5 + rng() * 5,
          size: 0.34,
          sway: 0.6,
          color: model.dropColor,
          kind: KIND_LIT,
        });
      }
      if (i % 5 === 4) {
        await nextFrame();
        if (disposed) return;
      }
    }

    // Airborne things.
    if (built.waterfall) {
      const f = built.waterfall;
      for (let k = 0; k < 46 * quality.particles; k++) {
        specs.push({
          origin: [f.x + f.dx * 1.2 + (rng() - 0.5) * 3, f.y - 6 - rng() * fallHeight * 0.55, f.z + f.dz * 1.2 + (rng() - 0.5) * 3],
          travel: [f.dx * 5 + (rng() - 0.5) * 6, -14 - rng() * 10, f.dz * 5 + (rng() - 0.5) * 6],
          period: 2.6 + rng() * 2.4,
          size: 0.4 + rng() * 0.5,
          sway: 0.9,
          color: [0.9, 0.96, 1],
          kind: KIND_LIT,
        });
      }
    }
    if (built.chimney) {
      for (let k = 0; k < 9; k++) {
        specs.push({ origin: built.chimney, travel: [2.5, 9, 1.2], period: 6.5, size: 0.85, sway: 0.5, color: [0.82, 0.8, 0.78], kind: KIND_LIT });
      }
    }
    for (let k = 0; k < 110 * quality.particles; k++) {
      const a = rng() * Math.PI * 2;
      const r = Math.sqrt(rng()) * built.radius * 0.92;
      const surface = built.surfaceAt(Math.cos(a) * r, Math.sin(a) * r);
      if (surface === null) continue;
      const firefly = k % 3 !== 0;
      specs.push({
        origin: [Math.cos(a) * r, surface + 0.8 + rng() * (firefly ? 5 : 9), Math.sin(a) * r],
        travel: [(rng() - 0.5) * 3, (rng() - 0.5) * 1.5, (rng() - 0.5) * 3],
        period: 8 + rng() * 8,
        size: firefly ? 0.3 : 0.16,
        sway: firefly ? 2.2 : 1.4,
        color: firefly ? [1, 0.82, 0.3] : [1, 0.98, 0.86],
        kind: firefly ? KIND_FIREFLY : KIND_DAY,
      });
    }
    particles = createParticles(specs, sky.state.ambient);
    if (particles) {
      scene.add(particles);
      disposables.push(particles.geometry, particles.material as THREE.Material, particles.userData.box as THREE.BufferGeometry);
    }

    // Satellite rocks, drifting at the edge of the frame for depth.
    for (let i = 0; i < 5; i++) {
      const radius = 3.5 + hash2(i, 71) * 4.5;
      const mesh = new THREE.Mesh(
        meshVolume(buildIslet(i * 17 + 3, radius), { include: () => true, occludes: () => true, color: terrainColor }),
        staticMaterial,
      );
      const angle = (i / 5) * Math.PI * 2 + hash2(i, 72) * 0.9 + 2.2;
      const orbit = built.radius + 16 + hash2(i, 73) * 30;
      const y = lerp(-built.radius * 0.55, built.radius * 0.12, hash2(i, 74));
      mesh.position.set(Math.cos(angle) * orbit, y, Math.sin(angle) * orbit);
      mesh.rotation.y = Math.floor(hash2(i, 75) * 4) * (Math.PI / 2);
      scene.add(mesh);
      disposables.push(mesh.geometry);
      islets.push({ mesh, y, phase: i * 1.7 });
    }

    await nextFrame();
    if (disposed) return;
    applySize();
    camera.position.copy(home.position);
    controls.target.copy(home.target);
    if (!reducedMotion) {
      // Arrive already moving: start a little high and wide, and settle as the trees assemble.
      camera.position.sub(home.target).multiplyScalar(1.22).add(home.target);
      camera.position.y += home.distance * 0.08;
      flyTo(home.position, home.target);
      flight.duration = 3.2;
    }
    ready = true;
    if (selectedId) world.setSelected(selectedId);
    if (process.env.NODE_ENV !== "production") {
      (window as unknown as Record<string, unknown>).__voxelWorld = { scene, camera, controls, renderer, island: built, shared };
    }
  };

  // --- Frame loop ------------------------------------------------------------------------------
  let raf = 0;
  let last = performance.now();
  let firstFrame = true;
  let slowFor = 0;
  let frameAverage = 1 / 60;
  const governed = typeof navigator !== "undefined" && !navigator.webdriver;
  const growDuration = clamp(3.6 + trees.length * 0.06, 3.6, 7);

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!ready || !sky || !island || document.hidden || !onScreen) return;
    clock += dt;
    shared.uTime.value = clock;
    if (shared.uGrow.value < 2) shared.uGrow.value = reducedMotion ? 2 : Math.min(2, shared.uGrow.value + dt / growDuration);

    // Day and night.
    dayRaw = reducedMotion ? dayTarget : clamp(dayRaw + Math.sign(dayTarget - dayRaw) * dt * 0.42, 0, 1);
    if (Math.abs(dayRaw - dayTarget) < 0.002) dayRaw = dayTarget;
    const day = smoothstep(0, 1, dayRaw);
    sky.update(day, reducedMotion ? 0 : dt, camera.position);
    shared.uNight.value = sky.state.night;
    glowMaterial?.color.setScalar(lerp(1.05, 2.3, sky.state.night));
    bloom.intensity = lerp(0.55, 1.25, sky.state.night);

    // Hover.
    if (pointerDirty) {
      pointerDirty = false;
      const id = pointerInside ? pick() : null;
      if (id !== hoveredId) {
        hoveredId = id;
        canvas.style.cursor = id ? "pointer" : "grab";
      }
    }

    // Camera.
    if (flight.active) {
      flight.t = Math.min(1, flight.t + dt / flight.duration);
      const k = easeInOut(flight.t);
      camera.position.lerpVectors(flight.fromP, flight.toP, k);
      controls.target.lerpVectors(flight.fromT, flight.toT, k);
      if (flight.t >= 1) flight.active = false;
    }
    controls.autoRotate = !reducedMotion && !selectedId && !flight.active && clock - interactedAt > 14;
    const reach = Math.hypot(controls.target.x, controls.target.z);
    if (reach > island.radius) {
      controls.target.x *= island.radius / reach;
      controls.target.z *= island.radius / reach;
    }
    controls.target.y = clamp(controls.target.y, island.bottom, island.summit + 34);
    controls.update(dt);

    // Slide the picture left while the detail panel is open, so the tree is not under it.
    // On a wide screen the island rests right of centre, clear of the label card.
    const shiftTarget = width < 760 ? 0 : selectedId ? 190 : width >= 1024 ? -width * 0.09 : 0;
    viewShift = reducedMotion || firstFrame ? shiftTarget : lerp(viewShift, shiftTarget, 1 - Math.exp(-dt * 5));
    if (Math.abs(viewShift) > 0.5) camera.setViewOffset(width, height, viewShift, 0, width, height);
    else if (camera.view) camera.clearViewOffset();

    // Trees and their tags.
    const pixel = (2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / height;
    const rate = 1 - Math.exp(-dt * 12);
    for (const entry of entries) {
      const active = entry.data.id === hoveredId || entry.data.id === selectedId;
      entry.ease = reducedMotion ? (active ? 1 : 0) : lerp(entry.ease, active ? 1 : 0, rate);
      entry.hover.value = entry.ease;
      const s = 1 + entry.ease * 0.035;
      entry.mesh.scale.setScalar(s);
      entry.mesh.position.set(entry.data.x - 0.5 * (s - 1), entry.base, entry.data.y - 0.5 * (s - 1));

      const label = entry.label;
      const distance = camera.position.distanceTo(label.sprite.position);
      const grown = smoothstep(entry.grownAt - 0.05, entry.grownAt + 0.05, shared.uGrow.value);
      // From the resting view the island is a picture and tags are clutter; they come up as you move in.
      const near = 1 - smoothstep(home.distance * 0.5, home.distance * 0.8, distance);
      const target = grown * (active ? 1 : selectedId ? 0.25 * near : 0.92 * near);
      label.opacity = lerp(label.opacity, target, rate);
      label.sprite.material.opacity = label.opacity;
      label.sprite.visible = label.opacity > 0.01;
      const zoom = active ? 3 : 2;
      label.sprite.scale.set(label.width * zoom * pixel, label.height * zoom * pixel, 1);
      label.sprite.renderOrder = active ? 30 : 20;
    }
    const hovered = hoveredId ? byId.get(hoveredId) : null;
    const selected = selectedId ? byId.get(selectedId) : null;
    hoverBox.visible = !!hovered && hovered !== selected;
    if (hovered) hoverBox.box.copy(hovered.box);
    selectBox.visible = !!selected;
    if (selected) selectBox.box.copy(selected.box);

    if (!reducedMotion) for (const islet of islets) islet.mesh.position.y = islet.y + Math.sin(clock * 0.45 + islet.phase) * 0.9;
    if (particles) (particles.material as THREE.ShaderMaterial).uniforms.uMotion.value = reducedMotion ? 0 : 1;

    composer.render(dt);

    if (firstFrame) {
      firstFrame = false;
      options.onReady();
      return;
    }
    // Governor: if the GPU cannot hold the frame, give up resolution, then bloom. It never climbs back --
    // a scene that flickers between two qualities is worse than one that settled on the lower.
    frameAverage = lerp(frameAverage, dt, 0.05);
    slowFor = frameAverage > SLOW_FRAME ? slowFor + dt : 0;
    if (governed && slowFor > 2.5) {
      slowFor = 0;
      frameAverage = 1 / 60;
      if (renderScale > 0.6) {
        renderScale = renderScale > 0.9 ? 0.78 : 0.58;
        applySize();
      } else if (bloomOn) {
        bloomOn = false;
        composer.removePass(effectPass);
        effectPass.dispose();
        effectPass = new EffectPass(camera, ...effects.filter((e) => e !== bloom));
        composer.addPass(effectPass);
      }
    }
  };

  const world: World = {
    setDark(isDark) {
      dayTarget = isDark ? 0 : 1;
    },
    setSelected(id) {
      const previous = selectedId;
      selectedId = id;
      if (!ready) return;
      const entry = id ? byId.get(id) : null;
      if (entry) {
        if (!previous) saved = { position: camera.position.clone(), target: controls.target.clone() };
        // Keep the current compass bearing, drop to a three-quarter view, and stand back by the tree's own height.
        const target = new THREE.Vector3(entry.data.x + 0.5, entry.base + entry.height * 0.52, entry.data.y + 0.5);
        const bearing = Math.atan2(camera.position.z - controls.target.z, camera.position.x - controls.target.x);
        const distance = Math.max(42, entry.height * 3.5) / Math.min(1, (width / height) * 1.1);
        const position = new THREE.Vector3(Math.cos(bearing) * Math.cos(0.42), Math.sin(0.42), Math.sin(bearing) * Math.cos(0.42))
          .multiplyScalar(distance)
          .add(target);
        flyTo(position, target);
      } else if (previous && saved) {
        flyTo(saved.position, saved.target);
        saved = null;
      }
    },
    setReducedMotion(reduced) {
      reducedMotion = reduced;
      shared.uWind.value = reduced ? 0 : 1;
      if (reduced) flight.active = false;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      controls.removeEventListener("start", onControlStart);
      controls.dispose();
      for (const d of disposables) d.dispose();
      hoverBox.dispose();
      selectBox.dispose();
      composer.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };

  applySize();
  canvas.style.cursor = "grab";
  raf = requestAnimationFrame(frame);
  void build();
  return world;
}
