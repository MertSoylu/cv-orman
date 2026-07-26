"use client";

import * as THREE from "three";

/**
 * The sky's current colors, shared by reference.
 *
 * `Atmosphere` eases these every frame; `Water` and `GroundFog` read them the
 * same frame. Passing live THREE objects rather than React state is deliberate:
 * the day/night transition is a continuous per-frame animation, and routing it
 * through state would re-render the whole scene graph sixty times a second to
 * communicate two colors.
 */
export interface SkyState {
  horizon: THREE.Color;
  zenith: THREE.Color;
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
}

export function createSkyState(isDark: boolean): SkyState {
  return {
    horizon: new THREE.Color(isDark ? "#2b3347" : "#d8c7a8"),
    zenith: new THREE.Color(isDark ? "#0d1424" : "#6f9ec9"),
    sunDirection: new THREE.Vector3(0.4, 0.6, -0.7).normalize(),
    sunColor: new THREE.Color(isDark ? "#9fb6d8" : "#fff0d0"),
  };
}
