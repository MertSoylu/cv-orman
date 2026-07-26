"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { getGroundTextures } from "../textures";
import { sampleTerrain, TRAIL_WIDTH } from "./heightfield";

/**
 * The valley floor: one displaced grid, vertex-colored by what the ground
 * *is* at each point rather than by a splat texture.
 *
 * Painting the ground type into vertex colors and multiplying a single shared
 * grain texture over the top gets turf, worn verge, riverbank sand and exposed
 * rock out of one material and one draw call, with no texture atlas to author
 * and no per-pixel blend weights to upload. The grain map supplies the micro
 * detail that keeps a 300-unit plane from reading as vinyl; the vertex colors
 * supply everything else.
 */

const TURF_SHADOW = new THREE.Color("#4e5f3a");
const TURF_LIGHT = new THREE.Color("#78864e");
/**
 * The mown strip either side of the walk.
 *
 * Lighter and yellower than the rough turf it sits in, because that is what
 * cut grass looks like, and because it is the single clearest signal in the
 * whole ground plane that somebody maintains this place. Before it, the band
 * flanking the gravel was worn dirt, which says the opposite: a path widening
 * into mud is what happens where nobody is looking after anything.
 */
const TURF_MOWN = new THREE.Color("#8b975a");
const VERGE_DIRT = new THREE.Color("#6d5940");
const BANK_SAND = new THREE.Color("#b6a07c");
const EXPOSED_ROCK = new THREE.Color("#8b8275");

/** World units of ground covered by one tile of the grain texture. */
const GRAIN_TILE = 7;

export interface TerrainProps {
  size: [number, number];
  center: [number, number];
  segments: number;
}

export default function Terrain({ size, center, segments }: TerrainProps) {
  const geometry = useMemo(() => {
    const grid = new THREE.PlaneGeometry(size[0], size[1], segments, segments);
    grid.rotateX(-Math.PI / 2);

    const position = grid.attributes.position;
    const uv = grid.attributes.uv;
    const colors = new Float32Array(position.count * 3);
    const color = new THREE.Color();

    for (let i = 0; i < position.count; i++) {
      const worldX = position.getX(i) + center[0];
      const worldZ = position.getZ(i) + center[1];
      const sample = sampleTerrain(worldX, worldZ);

      position.setY(i, sample.height);

      color.copy(TURF_SHADOW).lerp(TURF_LIGHT, sample.variation);
      // The mown band, fading out into rough turf. Wide enough to carry the
      // specimen plots standing in it, so each plot reads as a bed cut into a
      // tended lawn rather than as a patch of gravel dropped on a meadow.
      color.lerp(
        TURF_MOWN,
        (1 - smoothstepScalar(TRAIL_WIDTH * 0.7, TRAIL_WIDTH * 1.7, sample.pathDistance)) * 0.85,
      );
      // A thin line of worn earth right at the gravel's edge, so the ribbon
      // doesn't sit on lawn like a sticker. It has to stop *inside* the kerb:
      // the walk is edged now, and a verge that spills past the stone reads as
      // the path having burst its banks -- which is how the crossing ended up
      // with a bald apron of mud around it, since a wide verge, a wide wet
      // margin and the bridge gap all landed on the same few metres.
      color.lerp(
        VERGE_DIRT,
        (1 - smoothstepScalar(TRAIL_WIDTH * 0.46, TRAIL_WIDTH * 0.6, sample.pathDistance)) * 0.6,
      );
      // Kept narrow: a wide sand margin around a stream reads as a beach, and
      // the exhibit is a wood. Measured against the *local* channel width, so
      // the wet margin follows the water where it widens into a pool instead of
      // being painted at one fixed distance from the centerline.
      color.lerp(
        BANK_SAND,
        1 -
          smoothstepScalar(
            sample.streamHalfWidth * 0.8,
            sample.streamHalfWidth * 1.0,
            sample.streamDistance,
          ),
      );
      color.lerp(EXPOSED_ROCK, smoothstepScalar(0.4, 0.95, sample.slope));

      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;

      // Tile the grain map in world units rather than across the whole plane,
      // so its scale doesn't change with repo count.
      uv.setXY(i, (worldX / GRAIN_TILE), (worldZ / GRAIN_TILE));
    }

    grid.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    grid.computeVertexNormals();
    return grid;
  }, [size, center, segments]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  const textures = useMemo(() => getGroundTextures(), []);

  return (
    <mesh geometry={geometry} position={[center[0], 0, center[1]]} receiveShadow>
      <meshStandardMaterial
        vertexColors
        map={textures.map}
        normalMap={textures.normalMap}
        roughnessMap={textures.roughnessMap}
        normalScale={new THREE.Vector2(0.7, 0.7)}
        roughness={1}
        metalness={0}
        dithering
      />
    </mesh>
  );
}

function smoothstepScalar(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
