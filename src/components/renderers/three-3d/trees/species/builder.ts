"use client";

import * as THREE from "three";
import type { BarkKind, LeafShape } from "../../textures";

/**
 * The procedural tree generator.
 *
 * One parametric recipe drives all eight species: a trunk limb, a recursive
 * branch system grown off it, leaf cards scattered at the branch tips, and a
 * coarse hull for the far-distance LOD. Species files supply nothing but
 * parameters, so silhouettes differ by construction (branch angle, taper,
 * droop, whorl count) rather than by hand-tweaked one-offs that drift apart.
 *
 * Everything is emitted in *tree-local* space and merged into three geometries
 * per build -- bark, leaves, canopy. Each becomes a single InstancedMesh
 * covering every tree of that species variant, so a forest of any size costs
 * three draw calls per variant. That is only possible because the geometry is
 * baked in local space: the vertex shader can then bend it by local height,
 * and the instance matrix only has to carry the tree's placement.
 */

export type Rand = () => number;

// ---------------------------------------------------------------------------
// Geometry plumbing
// ---------------------------------------------------------------------------

/**
 * Concatenate indexed geometries that share an attribute set.
 *
 * Hand-rolled rather than pulled from BufferGeometryUtils: everything merged
 * here is produced a few lines away with a known, uniform attribute layout, so
 * the general-purpose version's morph/group handling is dead weight, and this
 * keeps the renderer free of `three/examples` import paths.
 */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry();
  if (list.length === 0) {
    merged.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    return merged;
  }

  const names = Object.keys(list[0].attributes);
  let vertexCount = 0;
  let indexCount = 0;
  for (const geometry of list) {
    vertexCount += geometry.attributes.position.count;
    indexCount += geometry.index ? geometry.index.count : geometry.attributes.position.count;
  }

  for (const name of names) {
    const itemSize = list[0].attributes[name].itemSize;
    const array = new Float32Array(vertexCount * itemSize);
    let offset = 0;
    for (const geometry of list) {
      const attribute = geometry.attributes[name];
      array.set(attribute.array as unknown as ArrayLike<number>, offset);
      offset += attribute.count * itemSize;
    }
    merged.setAttribute(name, new THREE.BufferAttribute(array, itemSize));
  }

  const indices =
    vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);
  let indexOffset = 0;
  let vertexOffset = 0;
  for (const geometry of list) {
    const count = geometry.attributes.position.count;
    if (geometry.index) {
      for (let i = 0; i < geometry.index.count; i++) {
        indices[indexOffset + i] = geometry.index.getX(i) + vertexOffset;
      }
      indexOffset += geometry.index.count;
    } else {
      for (let i = 0; i < count; i++) indices[indexOffset + i] = i + vertexOffset;
      indexOffset += count;
    }
    vertexOffset += count;
  }

  merged.setIndex(new THREE.BufferAttribute(indices, 1));
  merged.computeBoundingSphere();
  return merged;
}

function randomPerpendicular(dir: THREE.Vector3, rand: Rand): THREE.Vector3 {
  const guess = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5);
  if (guess.lengthSq() < 1e-6) guess.set(1, 0, 0);
  return guess.cross(dir).normalize();
}

// ---------------------------------------------------------------------------
// Limbs
// ---------------------------------------------------------------------------

export interface Limb {
  spine: THREE.Vector3[];
  radii: number[];
  /** Unit direction the limb is travelling at its far end. */
  endDirection: THREE.Vector3;
  length: number;
  depth: number;
}

/**
 * Grow one limb: step along a direction that wobbles randomly and is pulled by
 * `droop` (positive bends down under its own weight, negative reaches up for
 * light). This single function makes the trunk, the branches and the twigs --
 * the difference between a willow's trailing whip and a redwood's stiff spar
 * is entirely `droop` and `wobble`.
 */
export function growLimb(
  start: THREE.Vector3,
  direction: THREE.Vector3,
  length: number,
  radiusStart: number,
  radiusEnd: number,
  options: {
    wobble: number;
    droop: number;
    segments?: number;
    depth?: number;
    /** 0-1 pull back toward the starting direction each step. Keeps trunks upright. */
    tropism?: number;
  },
  rand: Rand,
): Limb {
  const segments = options.segments ?? 5;
  const step = length / segments;
  const home = direction.clone().normalize();
  const dir = home.clone();
  const point = start.clone();
  const spine = [point.clone()];
  const radii = [radiusStart];

  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    if (options.wobble > 0) {
      dir.applyAxisAngle(randomPerpendicular(dir, rand), (rand() - 0.5) * options.wobble);
    }
    // Droop accumulates: the far end of a limb sags much more than its base.
    dir.y -= options.droop * t * 0.5;
    // Without this the wobble is an unbounded random walk, and a seven-segment
    // trunk regularly ends up leaning 45 degrees. Real trunks correct back
    // toward the vertical as they grow; this is that, as one lerp.
    if (options.tropism) dir.lerp(home, options.tropism);
    dir.normalize();
    point.addScaledVector(dir, step);
    spine.push(point.clone());
    radii.push(THREE.MathUtils.lerp(radiusStart, radiusEnd, t));
  }

  return {
    spine,
    radii,
    endDirection: dir.clone(),
    length,
    depth: options.depth ?? 0,
  };
}

/**
 * Tube a limb's spine into geometry. Radius is sampled per ring, so limbs
 * taper continuously instead of stepping; a deterministic radial ripple gives
 * the silhouette the slight irregularity real bark has without needing a
 * displacement map.
 */
export function limbGeometry(
  limb: Limb,
  radialSegments: number,
  options: { ripple?: number; uvRepeat?: number; ringDensity?: number } = {},
): THREE.BufferGeometry {
  const ripple = options.ripple ?? 0.05;
  const uvRepeat = options.uvRepeat ?? 1;
  const curve = new THREE.CatmullRomCurve3(limb.spine);
  // Ring count is the dominant term in a forest's triangle budget: a tree has
  // one trunk and dozens of twigs, so oversampling the twigs costs far more
  // than oversampling the trunk saves. Callers give the trunk a denser ring
  // spacing and let the outer limbs run at one ring per spine point.
  const rings = Math.max(Math.round(limb.spine.length * (options.ringDensity ?? 2)) - 1, 4);
  const frames = curve.computeFrenetFrames(rings - 1, false);

  const positions = new Float32Array(rings * (radialSegments + 1) * 3);
  const normals = new Float32Array(rings * (radialSegments + 1) * 3);
  const uvs = new Float32Array(rings * (radialSegments + 1) * 2);
  const indices: number[] = [];

  const point = new THREE.Vector3();
  const offset = new THREE.Vector3();

  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1);
    curve.getPoint(t, point);

    // Radius interpolated through the limb's own control radii.
    const scaled = t * (limb.radii.length - 1);
    const lower = Math.min(Math.floor(scaled), limb.radii.length - 2);
    const radius = THREE.MathUtils.lerp(
      limb.radii[lower],
      limb.radii[lower + 1],
      scaled - lower,
    );

    const normal = frames.normals[Math.min(i, frames.normals.length - 1)];
    const binormal = frames.binormals[Math.min(i, frames.binormals.length - 1)];

    for (let j = 0; j <= radialSegments; j++) {
      const v = (j / radialSegments) * Math.PI * 2;
      const cos = Math.cos(v);
      const sin = Math.sin(v);
      offset.copy(normal).multiplyScalar(cos).addScaledVector(binormal, sin);

      const wobble = 1 + Math.sin(i * 2.7 + j * 3.1) * ripple;
      const index = i * (radialSegments + 1) + j;

      positions[index * 3] = point.x + offset.x * radius * wobble;
      positions[index * 3 + 1] = point.y + offset.y * radius * wobble;
      positions[index * 3 + 2] = point.z + offset.z * radius * wobble;

      normals[index * 3] = offset.x;
      normals[index * 3 + 1] = offset.y;
      normals[index * 3 + 2] = offset.z;

      uvs[index * 2] = (j / radialSegments) * 2;
      uvs[index * 2 + 1] = t * uvRepeat;
    }
  }

  for (let i = 0; i < rings - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// ---------------------------------------------------------------------------
// Foliage
// ---------------------------------------------------------------------------

export interface LeafAnchor {
  position: THREE.Vector3;
  /** Outward direction the card should face. */
  normal: THREE.Vector3;
  size: number;
}

const CARD_CORNERS: Array<[number, number]> = [
  [-0.5, -0.5],
  [0.5, -0.5],
  [0.5, 0.5],
  [-0.5, 0.5],
];

/**
 * Build the leaf-card mesh: one textured quad per anchor, oriented to face out
 * of the canopy, sampling one of the atlas's four cluster tiles.
 *
 * Corner normals are splayed outward from the card's own plane, which is the
 * standard vegetation trick for making a flat quad shade like a rounded sprig
 * -- without it a canopy of cards reads as a pile of cardboard.
 *
 * `aPhase` is baked per card (constant across its four corners) and drives the
 * per-card flutter in `treeShader.ts`.
 */
export function leafCardGeometry(anchors: LeafAnchor[], rand: Rand): THREE.BufferGeometry {
  const count = anchors.length;
  const positions = new Float32Array(count * 4 * 3);
  const normals = new Float32Array(count * 4 * 3);
  const uvs = new Float32Array(count * 4 * 2);
  const phases = new Float32Array(count * 4);
  const indices = new Uint32Array(count * 6);

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const cornerNormal = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const anchor = anchors[i];
    normal.copy(anchor.normal).normalize();
    if (normal.lengthSq() < 1e-6) normal.set(0, 1, 0);

    // Basis for the card, with a random roll so neighbouring cards built from
    // the same atlas tile never look like a repeated stamp.
    right.copy(randomPerpendicular(normal, rand));
    up.crossVectors(normal, right).normalize();
    const roll = rand() * Math.PI * 2;
    const rolledRight = right.clone().multiplyScalar(Math.cos(roll)).addScaledVector(up, Math.sin(roll));
    const rolledUp = up.clone().multiplyScalar(Math.cos(roll)).addScaledVector(right, -Math.sin(roll));

    const size = anchor.size;
    const tileX = rand() < 0.5 ? 0 : 1;
    const tileY = rand() < 0.5 ? 0 : 1;
    const phase = rand() * Math.PI * 2;

    for (let c = 0; c < 4; c++) {
      const [cx, cy] = CARD_CORNERS[c];
      const vertex = i * 4 + c;

      corner
        .copy(anchor.position)
        .addScaledVector(rolledRight, cx * size)
        .addScaledVector(rolledUp, cy * size);
      positions[vertex * 3] = corner.x;
      positions[vertex * 3 + 1] = corner.y;
      positions[vertex * 3 + 2] = corner.z;

      cornerNormal
        .copy(normal)
        .addScaledVector(rolledRight, cx * 0.7)
        .addScaledVector(rolledUp, cy * 0.7)
        .normalize();
      normals[vertex * 3] = cornerNormal.x;
      normals[vertex * 3 + 1] = cornerNormal.y;
      normals[vertex * 3 + 2] = cornerNormal.z;

      uvs[vertex * 2] = (tileX + (cx + 0.5)) * 0.5;
      uvs[vertex * 2 + 1] = (tileY + (cy + 0.5)) * 0.5;
      phases[vertex] = phase;
    }

    const base = i * 4;
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], i * 6);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Coarse stand-in for a canopy: a handful of squashed low-poly spheres covering
 * the same volume as the leaf cards. Drawn instead of the cards past the LOD
 * threshold, where a few hundred alpha-tested quads per tree would cost real
 * fill rate for detail nobody can resolve.
 */
export function canopyHullGeometry(anchors: LeafAnchor[], blobCount: number): THREE.BufferGeometry {
  if (anchors.length === 0) return mergeGeometries([]);

  const count = Math.min(blobCount, anchors.length);

  // Cluster the anchors *spatially*. Slicing the anchor array by index instead
  // looks equivalent and is not: anchors are emitted limb by limb, so any
  // contiguous slice spans the whole crown, and every blob ends up with the
  // radius of the entire canopy. That produced a forest of giant balls.
  const seeds: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push(anchors[Math.floor(((i + 0.5) * anchors.length) / count)].position.clone());
  }

  const clusters: LeafAnchor[][] = Array.from({ length: count }, () => []);
  for (const anchor of anchors) {
    let best = 0;
    let bestSq = Infinity;
    for (let i = 0; i < count; i++) {
      const sq = anchor.position.distanceToSquared(seeds[i]);
      if (sq < bestSq) {
        bestSq = sq;
        best = i;
      }
    }
    clusters[best].push(anchor);
  }

  const parts: THREE.BufferGeometry[] = [];
  for (const cluster of clusters) {
    if (cluster.length === 0) continue;

    const center = new THREE.Vector3();
    for (const anchor of cluster) center.add(anchor.position);
    center.divideScalar(cluster.length);

    // Mean spread, not max: the max distance is an outlier's distance, and
    // sizing to it inflates every blob past the foliage it stands in for.
    let spread = 0;
    let cardSize = 0;
    for (const anchor of cluster) {
      spread += anchor.position.distanceTo(center);
      cardSize += anchor.size;
    }
    spread /= cluster.length;
    cardSize /= cluster.length;

    const blob = new THREE.IcosahedronGeometry(spread * 1.15 + cardSize * 0.6, 1);
    blob.scale(1, 0.85, 1);
    blob.translate(center.x, center.y, center.z);
    parts.push(blob);
  }

  return mergeGeometries(parts);
}

// ---------------------------------------------------------------------------
// The parametric tree
// ---------------------------------------------------------------------------

export interface SpeciesParams {
  trunkHeight: [number, number];
  trunkRadius: number;
  /** Top radius as a fraction of the base. Low = a sharp spire, high = a column. */
  trunkTaper: number;
  trunkWobble: number;
  /** Negative leans the trunk into an upward reach; positive lets it sag. */
  trunkDroop: number;
  /** Buttress-root flare at the base, as a multiple of trunk radius. 0 = none. */
  rootFlare: number;
  /** Recursion depth of the branch system. 0 = a bare pole (palm). */
  levels: number;
  /** Children spawned per limb, per level. */
  branching: [number, number];
  /** Angle a child leaves its parent at, in radians. */
  branchAngle: [number, number];
  /** Child length / parent length. */
  lengthRatio: number;
  /** Child radius / parent radius. */
  radiusRatio: number;
  /** Fraction of the parent below which no children attach. */
  branchStart: number;
  branchWobble: number;
  branchDroop: number;
  /**
   * Whorled branching (conifers): children of the trunk are placed in evenly
   * spaced rings rather than spiralling, which is most of what makes a pine
   * read as a pine.
   */
  whorls: boolean;
  leafShape: LeafShape;
  leafCards: number;
  leafSize: [number, number];
  /** Radius of the jittered cluster of cards dropped at each branch tip. */
  clumpRadius: number;
  /** Scatter cards along the last level's whole length, not just its tip (willow). */
  leavesAlongLimb: boolean;
  canopyBlobs: number;
  barkKind: BarkKind;
  barkColor: string;
  foliageColor: string;
  radialSegments: [number, number];
}

export interface TreeBuild {
  bark: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
  canopy: THREE.BufferGeometry;
  barkKind: BarkKind;
  barkColor: THREE.Color;
  leafShape: LeafShape;
  foliageColor: THREE.Color;
  /** Local-space height of the finished tree, used for camera framing and plaque placement. */
  height: number;
  /** Local-space radius of the canopy, used for the hover halo and hit proxy. */
  spread: number;
}

export function buildTree(params: SpeciesParams, rand: Rand, foliageDensity: number): TreeBuild {
  const barkParts: THREE.BufferGeometry[] = [];
  const anchors: LeafAnchor[] = [];

  const trunkHeight = THREE.MathUtils.lerp(params.trunkHeight[0], params.trunkHeight[1], rand());
  const trunk = growLimb(
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3((rand() - 0.5) * 0.06, 1, (rand() - 0.5) * 0.06),
    trunkHeight,
    params.trunkRadius,
    params.trunkRadius * params.trunkTaper,
    { wobble: params.trunkWobble, droop: params.trunkDroop, segments: 7, depth: 0, tropism: 0.32 },
    rand,
  );
  barkParts.push(
    limbGeometry(trunk, params.radialSegments[0], { uvRepeat: trunkHeight * 0.45, ringDensity: 2 }),
  );

  if (params.rootFlare > 0) {
    const rootCount = 4 + Math.floor(rand() * 3);
    for (let i = 0; i < rootCount; i++) {
      const angle = (i / rootCount) * Math.PI * 2 + rand() * 0.4;
      const direction = new THREE.Vector3(Math.cos(angle), -0.55, Math.sin(angle));
      const root = growLimb(
        new THREE.Vector3(0, params.trunkRadius * params.rootFlare * 1.5, 0),
        direction,
        params.trunkRadius * params.rootFlare * 2.1,
        params.trunkRadius * 0.62,
        params.trunkRadius * 0.12,
        { wobble: 0.25, droop: 0.5, segments: 3 },
        rand,
      );
      barkParts.push(limbGeometry(root, 5, { ripple: 0.08, ringDensity: 1 }));
    }
  }

  // Breadth-first growth, so `levels` reads as real depth and the tip list at
  // the end is exactly the outermost ring of twigs.
  let frontier: Limb[] = [trunk];
  for (let level = 1; level <= params.levels; level++) {
    const next: Limb[] = [];
    const isLast = level === params.levels;

    for (const parent of frontier) {
      const childCount =
        Math.round(THREE.MathUtils.lerp(params.branching[0], params.branching[1], rand())) +
        (level === 1 && params.whorls ? 1 : 0);

      for (let c = 0; c < childCount; c++) {
        // Whorled species place children in even rings up the parent; the rest
        // spiral by the golden angle, which is what real phyllotaxis does and
        // what keeps branches from stacking on one side.
        const along = params.whorls
          ? params.branchStart +
            (1 - params.branchStart) * ((Math.floor(c / 4) + 0.5) / Math.ceil(childCount / 4))
          : params.branchStart + (1 - params.branchStart) * ((c + rand() * 0.7) / childCount);
        const azimuth = params.whorls
          ? ((c % 4) / 4) * Math.PI * 2 + Math.floor(c / 4) * 0.6
          : c * 2.399963 + rand() * 0.5;

        const index = THREE.MathUtils.clamp(
          Math.round(along * (parent.spine.length - 1)),
          1,
          parent.spine.length - 1,
        );
        const attach = parent.spine[index].clone();
        const parentDir =
          index > 0
            ? parent.spine[index].clone().sub(parent.spine[index - 1]).normalize()
            : parent.endDirection.clone();

        const angle = THREE.MathUtils.lerp(params.branchAngle[0], params.branchAngle[1], rand());
        const axis = randomPerpendicular(parentDir, rand);
        const direction = parentDir
          .clone()
          .applyAxisAngle(axis, angle)
          .applyAxisAngle(parentDir, azimuth)
          .normalize();

        const length = parent.length * params.lengthRatio * (0.75 + rand() * 0.5);
        const radiusStart = parent.radii[index] * params.radiusRatio;
        const child = growLimb(
          attach,
          direction,
          length,
          radiusStart,
          radiusStart * 0.35,
          {
            wobble: params.branchWobble,
            droop: params.branchDroop * level,
            segments: isLast ? 4 : 5,
            depth: level,
          },
          rand,
        );

        // Twigs past the first branch level are thinner than a pixel at any
        // distance the viewer actually reads them from, so they get a
        // triangular cross-section. This is where the forest's triangle budget
        // is won or lost -- there are ten times as many twigs as branches.
        const radial = level === 1 ? params.radialSegments[1] : 3;
        barkParts.push(
          limbGeometry(child, radial, { ripple: 0.07, uvRepeat: length * 0.5, ringDensity: 1 }),
        );
        next.push(child);
      }
    }
    frontier = next;
    if (frontier.length === 0) break;
  }

  // Leaf anchors: clusters at the outermost limbs (or along them, for willows).
  const cardBudget = Math.max(12, Math.round(params.leafCards * foliageDensity));
  const sources = frontier.length > 0 ? frontier : [trunk];
  const perSource = Math.max(1, Math.round(cardBudget / sources.length));

  for (const limb of sources) {
    for (let i = 0; i < perSource; i++) {
      const t = params.leavesAlongLimb ? 0.15 + rand() * 0.85 : 0.72 + rand() * 0.28;
      const scaled = t * (limb.spine.length - 1);
      const lower = Math.min(Math.floor(scaled), limb.spine.length - 2);
      const base = limb.spine[lower]
        .clone()
        .lerp(limb.spine[lower + 1], scaled - lower);

      const jitter = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5)
        .normalize()
        .multiplyScalar(params.clumpRadius * (0.35 + rand() * 0.65));
      const position = base.add(jitter);

      anchors.push({
        position,
        // Face away from the trunk axis, biased upward -- the canopy shell's
        // outward normal, approximated without needing its actual surface.
        normal: new THREE.Vector3(position.x, position.y * 0.35 + 0.45, position.z).normalize(),
        size: THREE.MathUtils.lerp(params.leafSize[0], params.leafSize[1], rand()),
      });
    }
  }

  let height = 0;
  let spread = 0;
  for (const anchor of anchors) {
    height = Math.max(height, anchor.position.y + anchor.size);
    spread = Math.max(spread, Math.hypot(anchor.position.x, anchor.position.z) + anchor.size);
  }
  for (const point of trunk.spine) height = Math.max(height, point.y);

  return {
    bark: mergeGeometries(barkParts),
    leaves: leafCardGeometry(anchors, rand),
    canopy: canopyHullGeometry(anchors, params.canopyBlobs),
    barkKind: params.barkKind,
    barkColor: new THREE.Color(params.barkColor),
    leafShape: params.leafShape,
    foliageColor: new THREE.Color(params.foliageColor),
    height,
    spread: Math.max(spread, params.trunkRadius * 3),
  };
}
