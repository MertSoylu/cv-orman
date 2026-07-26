"use client";

import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { getMistTexture } from "../textures";
import { setOpacity } from "../imperative";

/**
 * Low mist hugging the valley floor.
 *
 * Three large horizontal planes at slightly different heights, each scrolling
 * its noise alpha at a different speed. Parallax between the layers is what
 * makes it read as volume; a single layer reads as a decal, and true volumetric
 * fog would mean a raymarch this scene's frame budget has no room for.
 *
 * Written back-to-front with depth writes off so the layers composite cleanly
 * against the terrain and each other.
 */

/**
 * Opacities are deliberately low. These planes are the width of the whole
 * valley, so anything above ~0.15 stops reading as mist and becomes an opaque
 * sheet laid over the terrain -- the layering, not the density, is what sells
 * the effect.
 */
const LAYERS = [
  { height: 0.35, scale: 0.09, speed: 0.0055, opacity: 0.15 },
  { height: 0.9, scale: 0.055, speed: -0.0034, opacity: 0.1 },
  { height: 1.7, scale: 0.034, speed: 0.0021, opacity: 0.06 },
];

const DAY_COLOR = new THREE.Color("#e6dcc6");
const NIGHT_COLOR = new THREE.Color("#8fa0bd");

export interface GroundFogProps {
  size: [number, number];
  center: [number, number];
  isDark: boolean;
  reducedMotion: boolean;
}

export default function GroundFog({ size, center, isDark, reducedMotion }: GroundFogProps) {
  const dayFactor = useRef(isDark ? 0 : 1);

  const layers = useMemo(
    () =>
      LAYERS.map((layer) => {
        // One shared source image, one clone per layer: cloning keeps the
        // decoded texture but gives each layer its own offset and repeat.
        const texture = getMistTexture().clone();
        texture.wrapS = THREE.RepeatWrapping;
        texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(size[0] * layer.scale, size[1] * layer.scale);
        texture.needsUpdate = true;

        const material = new THREE.MeshBasicMaterial({
          map: texture,
          color: DAY_COLOR.clone(),
          transparent: true,
          opacity: layer.opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        });

        return { ...layer, texture, material };
      }),
    [size],
  );

  useEffect(
    () => () => {
      for (const layer of layers) {
        layer.texture.dispose();
        layer.material.dispose();
      }
    },
    [layers],
  );

  useFrame((_, delta) => {
    dayFactor.current = reducedMotion
      ? isDark
        ? 0
        : 1
      : THREE.MathUtils.damp(dayFactor.current, isDark ? 0 : 1, 1.6, delta);

    for (const layer of layers) {
      if (!reducedMotion) {
        layer.texture.offset.setX(layer.texture.offset.x + layer.speed * delta * 12);
      }
      layer.material.color.copy(NIGHT_COLOR).lerp(DAY_COLOR, dayFactor.current);
      // Mist reads much more strongly at night; by day it is a haze, not a bank.
      setOpacity(layer.material, layer.opacity * THREE.MathUtils.lerp(1, 0.45, dayFactor.current));
    }
  });

  return (
    <group position={[center[0], 0, center[1]]}>
      {layers.map((layer, index) => (
        <mesh
          key={layer.height}
          position={[0, layer.height, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={layer.material}
          renderOrder={10 + index}
          raycast={() => null}
        >
          <planeGeometry args={[size[0], size[1]]} />
        </mesh>
      ))}
    </group>
  );
}
