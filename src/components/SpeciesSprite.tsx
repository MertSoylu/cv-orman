import type { Species } from "@/lib/forest/treeData";

/**
 * Eight-pixel portraits of the eight species, drawn as SVG rects.
 *
 * They are the legend's key, the hover card's icon and the detail panel's
 * header -- one small picture that ties a row of text to a silhouette on the
 * island. Colours are the same hex values `renderers/voxel/trees.ts` sculpts
 * with; keep the two in step by hand.
 */
const SPRITES: Record<Species, { rows: string[]; leaf: string; bark: string; languages: string }> = {
  oak: { rows: [".LLLLL.", "LLLLLLL", "LLLLLLL", ".LLLLL.", "...B...", "...B...", "..BBB.."], leaf: "#4f8f3a", bark: "#6e4b2f", languages: "TS · JS · Java · Kotlin · C#" },
  pine: { rows: ["...L...", "..LLL..", "..LLL..", ".LLLLL.", ".LLLLL.", "LLLLLLL", "...B..."], leaf: "#2d6a49", bark: "#5b3e29", languages: "Rust · C · C++ · Zig" },
  redwood: { rows: ["..LLL..", "..LLL..", ".LLLLL.", "..LBL..", "...B...", "...B...", "..BBB.."], leaf: "#3c7446", bark: "#96503a", languages: "Go · Scala · Haskell" },
  sakura: { rows: [".LL.LL.", "LLLLLLL", "LLLLLLL", ".L.B.L.", "..BB...", "...B...", "...B..."], leaf: "#f3a3bf", bark: "#4f3833", languages: "Python · Ruby · Elixir" },
  birch: { rows: ["..LLL..", ".LLLLL.", ".LLBLL.", "..LBL..", "...B...", "...B...", "...B..."], leaf: "#a2c84e", bark: "#d9d2c2", languages: "HTML · CSS · Vue · Svelte" },
  willow: { rows: [".LLLLL.", "LLLLLLL", "LLLBLLL", "L.LBL.L", "L..B..L", "...B...", "..BBB.."], leaf: "#84a94f", bark: "#6c5b3c", languages: "PHP · Lua · Perl · R" },
  palm: { rows: ["LL.L.LL", ".LLLLL.", "L.LBL.L", "...B...", "..B....", "..B....", ".BB...."], leaf: "#4fa24c", bark: "#a17f54", languages: "Swift · Dart · Obj-C" },
  generic: { rows: [".LLLLL.", ".LLLLL.", ".LLLLL.", ".LLLLL.", "...B...", "...B...", "...B..."], leaf: "#3f9a72", bark: "#70523a", languages: "Shell · Docker · …" },
};

export const SPECIES_ORDER: Species[] = ["oak", "pine", "redwood", "sakura", "birch", "willow", "palm", "generic"];

export function speciesLanguages(species: Species): string {
  return SPRITES[species].languages;
}

export default function SpeciesSprite({ species, size = 21 }: { species: Species; size?: number }) {
  const sprite = SPRITES[species];
  return (
    <svg width={size} height={size} viewBox="0 0 7 7" shapeRendering="crispEdges" aria-hidden="true" className="shrink-0">
      {sprite.rows.flatMap((row, y) =>
        [...row].map((cell, x) =>
          cell === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={cell === "L" ? sprite.leaf : sprite.bark} />,
        ),
      )}
    </svg>
  );
}
