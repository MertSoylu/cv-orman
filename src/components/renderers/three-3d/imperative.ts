"use client";

import type * as THREE from "three";

/**
 * Per-frame writes to long-lived three.js objects.
 *
 * React's compiler rules (`react-hooks/immutability`, `react-hooks/refs`)
 * forbid both assigning to a property of a value created during render and
 * reading a ref while rendering. That is exactly right for React data -- and
 * exactly wrong for three.js scene state, which is long-lived GPU-side objects
 * that are *meant* to be driven imperatively from the frame loop.
 *
 * Method calls on those objects (`Color.copy`, `Vector2.setX`, `Matrix4.compose`)
 * are already invisible to the rule, which is why almost all of this renderer's
 * animation reads naturally. These helpers extend the same treatment to the
 * handful of plain properties three.js exposes with no setter -- a uniform's
 * `.value`, a material's `.opacity` and `.emissiveIntensity`.
 *
 * **This is not only a lint concern.** In development the React Compiler
 * runtime *recursively freezes* the plain objects and arrays a `useMemo`
 * returns. A uniform written as the object literal `{ value: 0 }` therefore
 * ends up frozen, and `uniform.value = t` becomes a silent no-op -- the wind
 * stops, the water stops rippling, and nothing anywhere reports an error. Class
 * instances are skipped by that freeze, which is why every uniform in this
 * renderer is a `THREE.Uniform` rather than a bare object literal, and why the
 * `Color`/`Vector3`-valued ones kept working while the numeric ones did not.
 *
 * Prefer a three.js method where one exists; reach for these only when there
 * isn't one.
 */

/**
 * Write a shader uniform's value.
 *
 * `uniform` must be a `THREE.Uniform` instance, not an object literal -- see
 * the note above.
 */
export function setUniform<T>(uniform: THREE.IUniform<T>, value: T): void {
  uniform.value = value;
}

/** Set a transparent material's opacity. */
export function setOpacity(material: THREE.Material, opacity: number): void {
  material.opacity = opacity;
}

/** Set a standard material's emissive strength. */
export function setEmissiveIntensity(
  material: THREE.MeshStandardMaterial,
  intensity: number,
): void {
  material.emissiveIntensity = intensity;
}
