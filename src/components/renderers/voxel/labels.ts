import * as THREE from "three";

/**
 * Name tags, set in a 5x7 bitmap font defined right here.
 *
 * A web font would be the one smooth, antialiased thing in a world of cubes --
 * and would need a network fetch to render a dozen repo names. Repository
 * names are ASCII by GitHub's own rules, so forty glyphs cover every label
 * this scene can ever need.
 *
 * Tags are drawn at a whole number of screen pixels per font pixel regardless
 * of distance (`sizeAttenuation: false`, rescaled on resize), because a pixel
 * font is only crisp at integer scales.
 */

const GLYPHS: Record<string, number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30], C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30], E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17], I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12], K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17], O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16], Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4], U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4], W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
  "0": [14, 17, 19, 21, 25, 17, 14], "1": [4, 12, 4, 4, 4, 4, 14], "2": [14, 17, 1, 2, 4, 8, 31],
  "3": [30, 1, 1, 14, 1, 1, 30], "4": [2, 6, 10, 18, 31, 2, 2], "5": [31, 16, 30, 1, 1, 17, 14],
  "6": [6, 8, 16, 30, 17, 17, 14], "7": [31, 1, 2, 4, 8, 8, 8], "8": [14, 17, 17, 14, 17, 17, 14],
  "9": [14, 17, 17, 15, 1, 2, 12], "-": [0, 0, 0, 31, 0, 0, 0], _: [0, 0, 0, 0, 0, 0, 31],
  ".": [0, 0, 0, 0, 0, 12, 12], "?": [14, 17, 1, 2, 4, 0, 4], "*": [4, 4, 31, 14, 14, 27, 17], " ": [0, 0, 0, 0, 0, 0, 0],
};

const MAX_CHARS = 22;
const PAD = 4;
const DOT = 5;

export interface Label {
  sprite: THREE.Sprite;
  /** Texture size in font pixels. */
  width: number;
  height: number;
  opacity: number;
  zoom: number;
}

/** `NAME *12`: the repo's name and its star count, so a tag reads as a project and not as a species label. */
export function createLabel(name: string, healthColor: string, stars: number): Label {
  let text = name.toUpperCase();
  if (text.length > MAX_CHARS) text = `${text.slice(0, MAX_CHARS - 2)}..`;
  const nameLength = text.length;
  if (stars > 0) text += ` *${stars > 9999 ? "9999" : stars}`;
  const width = PAD * 2 + DOT + 3 + text.length * 6 - 1;
  const height = 7 + PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "rgba(27, 24, 21, 0.9)";
  ctx.fillRect(1, 0, width - 2, height);
  ctx.fillRect(0, 1, width, height - 2);
  ctx.fillStyle = "rgba(243, 238, 231, 0.28)";
  ctx.fillRect(1, 0, width - 2, 1);
  ctx.fillRect(1, height - 1, width - 2, 1);
  ctx.fillRect(0, 1, 1, height - 2);
  ctx.fillRect(width - 1, 1, 1, height - 2);
  ctx.fillStyle = healthColor;
  ctx.fillRect(PAD, PAD + 1, DOT, DOT);
  [...text].forEach((char, i) => {
    ctx.fillStyle = i > nameLength ? "#f2c94c" : "#f3eee7";
    const rows = GLYPHS[char] ?? GLYPHS["?"];
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 5; x++)
        if (rows[y] & (16 >> x)) ctx.fillRect(PAD + DOT + 3 + i * 6 + x, PAD + y, 1, 1);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 0);
  sprite.renderOrder = 20;
  return { sprite, width, height, opacity: 0, zoom: 2 };
}
