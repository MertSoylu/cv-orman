import * as THREE from "three";

/**
 * A dense box of voxels and the mesher that turns it into triangles.
 *
 * Everything solid in the scene -- the island, every tree, the clouds, the
 * cabin -- is authored as cells in a `Volume` and goes through `meshVolume`.
 * That one path is what makes the world read as a single material: every
 * surface gets the same hidden-face culling and, more importantly, the same
 * baked **ambient occlusion**. The AO is the classic three-neighbour corner
 * test, and it is doing most of the work in the picture: flat-shaded cubes
 * with no AO look like a spreadsheet, the same cubes with it look like a
 * sculpture.
 *
 * World position of a cell is its index plus the volume's origin, and a cell
 * with index `i` occupies `[i, i + 1]`.
 */
export class Volume {
  readonly data: Uint8Array;
  /** Optional per-cell byte. Trees store each voxel's birth time in it. */
  aux: Uint8Array | null = null;

  constructor(
    readonly sx: number,
    readonly sy: number,
    readonly sz: number,
    readonly ox = 0,
    readonly oy = 0,
    readonly oz = 0,
  ) {
    this.data = new Uint8Array(sx * sy * sz);
  }

  index(x: number, y: number, z: number): number {
    const lx = x - this.ox;
    const ly = y - this.oy;
    const lz = z - this.oz;
    if (lx < 0 || ly < 0 || lz < 0 || lx >= this.sx || ly >= this.sy || lz >= this.sz) return -1;
    return (lz * this.sy + ly) * this.sx + lx;
  }

  get(x: number, y: number, z: number): number {
    const i = this.index(x, y, z);
    return i < 0 ? 0 : this.data[i];
  }

  set(x: number, y: number, z: number, id: number): void {
    const i = this.index(x, y, z);
    if (i >= 0) this.data[i] = id;
  }

  /** Set only if the cell is empty. */
  fill(x: number, y: number, z: number, id: number): void {
    const i = this.index(x, y, z);
    if (i >= 0 && this.data[i] === 0) this.data[i] = id;
  }
}

export interface MeshOptions {
  /** Which voxel ids this mesh draws. */
  include: (id: number) => boolean;
  /** Which voxel ids hide the faces behind them and darken the corners near them. */
  occludes: (id: number) => boolean;
  /** Linear RGB for one face of one voxel. `face`: 0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z. */
  color: (id: number, x: number, y: number, z: number, face: number, out: number[]) => void;
  /**
   * Emit the per-voxel attributes the grow-in animation needs (`aCenter`,
   * `aInfo`), and keep a face that will be buried later whenever its voxel is
   * born *before* the neighbour that buries it -- otherwise a half-grown tree
   * shows holes where its future self would be.
   */
  animated?: { birthOffset: number; birthSpan: number; flag: (id: number) => number };
  /** Baked point-light term at a world position (lanterns, windows). */
  light?: (x: number, y: number, z: number) => number;
  /** Brightness per AO level, darkest first. */
  aoCurve?: [number, number, number, number];
}

// Per face: normal, then two tangents chosen so that u x v = n (CCW from outside).
const FACES: ReadonlyArray<readonly [number[], number[], number[]]> = [
  [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
  [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
  [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
];
const CORNERS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const DEFAULT_AO: [number, number, number, number] = [0.46, 0.66, 0.84, 1];

export function meshVolume(vol: Volume, opts: MeshOptions): THREE.BufferGeometry {
  const { sx, sy, sz, ox, oy, oz, data, aux } = vol;
  const ao = opts.aoCurve ?? DEFAULT_AO;
  const anim = opts.animated;

  // Classify ids once; the inner loop then never calls back for them.
  const inc = new Uint8Array(256);
  const occ = new Uint8Array(256);
  for (let id = 1; id < 256; id++) {
    inc[id] = opts.include(id) ? 1 : 0;
    occ[id] = opts.occludes(id) ? 1 : 0;
  }
  const solid = (lx: number, ly: number, lz: number): number => {
    if (lx < 0 || ly < 0 || lz < 0 || lx >= sx || ly >= sy || lz >= sz) return 0;
    return occ[data[(lz * sy + ly) * sx + lx]];
  };

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const centers: number[] = [];
  const infos: number[] = [];
  const glows: number[] = [];
  const rgb = [0, 0, 0];
  const cornerAo = [0, 0, 0, 0];
  let vertexCount = 0;

  for (let lz = 0; lz < sz; lz++) {
    for (let ly = 0; ly < sy; ly++) {
      for (let lx = 0; lx < sx; lx++) {
        const cell = (lz * sy + ly) * sx + lx;
        const id = data[cell];
        if (id === 0 || inc[id] === 0) continue;
        const wx = lx + ox;
        const wy = ly + oy;
        const wz = lz + oz;

        for (let f = 0; f < 6; f++) {
          const [n, u, v] = FACES[f];
          const nx = lx + n[0];
          const ny = ly + n[1];
          const nz = lz + n[2];
          if (solid(nx, ny, nz)) {
            if (!anim || !aux) continue;
            const neighbour = (nz * sy + ny) * sx + nx;
            if (aux[cell] >= aux[neighbour]) continue;
          }

          opts.color(id, wx, wy, wz, f, rgb);
          for (let c = 0; c < 4; c++) {
            const [du, dv] = CORNERS[c];
            const s1 = solid(nx + du * u[0], ny + du * u[1], nz + du * u[2]);
            const s2 = solid(nx + dv * v[0], ny + dv * v[1], nz + dv * v[2]);
            const s3 = solid(
              nx + du * u[0] + dv * v[0],
              ny + du * u[1] + dv * v[1],
              nz + du * u[2] + dv * v[2],
            );
            const level = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
            cornerAo[c] = level;
            const shade = ao[level];
            const px = wx + 0.5 + 0.5 * (n[0] + du * u[0] + dv * v[0]);
            const py = wy + 0.5 + 0.5 * (n[1] + du * u[1] + dv * v[1]);
            const pz = wz + 0.5 + 0.5 * (n[2] + du * u[2] + dv * v[2]);
            positions.push(px, py, pz);
            normals.push(n[0], n[1], n[2]);
            colors.push(rgb[0] * shade, rgb[1] * shade, rgb[2] * shade);
            if (opts.light) glows.push(opts.light(px + n[0] * 0.5, py + n[1] * 0.5, pz + n[2] * 0.5));
            if (anim) {
              centers.push(wx + 0.5, wy + 0.5, wz + 0.5);
              const birth = aux ? aux[cell] / 255 : 0;
              infos.push(anim.birthOffset + birth * anim.birthSpan, anim.flag(id));
            }
          }
          // Split the quad along the diagonal that keeps the AO gradient continuous.
          if (cornerAo[0] + cornerAo[2] < cornerAo[1] + cornerAo[3]) {
            indices.push(vertexCount + 1, vertexCount + 2, vertexCount + 3, vertexCount + 1, vertexCount + 3, vertexCount);
          } else {
            indices.push(vertexCount, vertexCount + 1, vertexCount + 2, vertexCount, vertexCount + 2, vertexCount + 3);
          }
          vertexCount += 4;
        }
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Int8BufferAttribute(normals, 3, false));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  if (opts.light) geometry.setAttribute("aGlow", new THREE.Float32BufferAttribute(glows, 1));
  if (anim) {
    geometry.setAttribute("aCenter", new THREE.Float32BufferAttribute(centers, 3));
    geometry.setAttribute("aInfo", new THREE.Float32BufferAttribute(infos, 2));
  }
  geometry.setIndex(vertexCount > 65535 ? new THREE.Uint32BufferAttribute(indices, 1) : new THREE.Uint16BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

/** sRGB hex -> linear RGB triple, the space vertex colours are stored in. */
export function rgbOf(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
