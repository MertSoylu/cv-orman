import type { Species } from "@/lib/forest/treeData";

/**
 * Primary language -> tree species. Grouped so each species covers a family of
 * languages with a similar "feel", and so the eight silhouettes stay roughly
 * balanced across a typical repo list instead of every tree being an oak.
 */
const LANGUAGE_TO_SPECIES: Record<string, Species> = {
  // Broad, branching canopies: the general-purpose application languages.
  TypeScript: "oak",
  JavaScript: "oak",
  Java: "oak",
  Kotlin: "oak",
  "C#": "oak",

  // Tight conifers: the systems languages.
  Rust: "pine",
  "C++": "pine",
  C: "pine",
  Zig: "pine",
  Nim: "pine",

  // Tall columnar trunks: the infrastructure/backend languages.
  Go: "redwood",
  Scala: "redwood",
  Haskell: "redwood",
  Erlang: "redwood",

  // Light, blossoming crowns: the scripting/data languages.
  Python: "sakura",
  Ruby: "sakura",
  Elixir: "sakura",
  Julia: "sakura",

  // Slender white trunks: the markup/styling layer.
  HTML: "birch",
  CSS: "birch",
  SCSS: "birch",
  Vue: "birch",
  Svelte: "birch",
  Astro: "birch",
  MDX: "birch",

  // Drooping canopies: the older/glue scripting languages.
  PHP: "willow",
  Lua: "willow",
  Perl: "willow",
  R: "willow",

  // Fronds: the Apple/mobile platform languages.
  Swift: "palm",
  Dart: "palm",
  "Objective-C": "palm",

  // Everything toolchain-shaped stays deliberately plain.
  Shell: "generic",
  Dockerfile: "generic",
  Makefile: "generic",
  PowerShell: "generic",
};

export function mapLanguageToSpecies(primaryLanguage: string | null): Species {
  if (!primaryLanguage) {
    return "generic";
  }
  return LANGUAGE_TO_SPECIES[primaryLanguage] ?? "generic";
}
