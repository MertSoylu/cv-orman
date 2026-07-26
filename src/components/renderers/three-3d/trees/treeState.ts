"use client";

import * as THREE from "three";

/**
 * Per-tree animation state, uploaded as a tiny `treeCount x 1` float texture.
 *
 * This is the load-bearing idea of the whole renderer. Every animated property
 * of a tree -- hover pop, sprout-in, selection glow, and the near/far foliage
 * LOD crossfade -- is a *per-tree* scalar, while the geometry it drives is
 * instanced across the whole forest. Writing those scalars into one texture
 * and reading them back in the vertex shader means the CPU's per-frame cost is
 * four floats per tree (a few hundred bytes, once), not a matrix recomposition
 * per instance. Bark, leaf cards and the far-LOD canopy all sample the same
 * texture, so they can never drift out of sync with each other.
 *
 * Nearest filtering on purpose: a float texture is only guaranteed to be
 * linearly filterable with OES_texture_float_linear, and we want exact lookups
 * anyway.
 */

/** Channel layout of one texel. Kept here so the GLSL and the TS agree in one place. */
export const TREE_STATE_CHANNELS = {
  /** r -- 0..1 hover/selection emphasis. */
  HOVER: 0,
  /** g -- 0..1 sprout-in scale multiplier. */
  INTRO: 1,
  /** b -- 0..1 selection emphasis, a stronger and steadier glow than hover. */
  SELECT: 2,
  /** a -- 1 = draw detailed leaf cards, 0 = draw the cheap canopy hull. */
  LOD: 3,
} as const;

export class TreeStateBuffer {
  readonly texture: THREE.DataTexture;
  readonly count: number;
  private readonly data: Float32Array;

  constructor(count: number) {
    // Width 0 is illegal; a one-texel texture for an empty forest is harmless.
    this.count = Math.max(count, 1);
    this.data = new Float32Array(this.count * 4);
    this.texture = new THREE.DataTexture(
      this.data,
      this.count,
      1,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.needsUpdate = true;
  }

  set(index: number, hover: number, intro: number, select: number, lod: number): void {
    const i = index * 4;
    this.data[i] = hover;
    this.data[i + 1] = intro;
    this.data[i + 2] = select;
    this.data[i + 3] = lod;
  }

  get(index: number, channel: number): number {
    return this.data[index * 4 + channel];
  }

  /** Flag the whole texture dirty. Called once per frame after all writes. */
  commit(): void {
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.texture.dispose();
  }
}
