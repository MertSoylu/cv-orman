import type { Species } from "@/lib/forest/treeData";

const LANGUAGE_TO_SPECIES: Record<string, Species> = {
  TypeScript: "oak",
  JavaScript: "oak",
  Python: "sakura",
  Rust: "pine",
  Go: "birch",
  Java: "oak",
  Kotlin: "oak",
  "C#": "oak",
  "C++": "pine",
  C: "pine",
  Swift: "palm",
  Ruby: "sakura",
  PHP: "birch",
  HTML: "birch",
  CSS: "birch",
  Shell: "generic",
  Dockerfile: "generic",
};

export function mapLanguageToSpecies(primaryLanguage: string | null): Species {
  if (!primaryLanguage) {
    return "generic";
  }
  return LANGUAGE_TO_SPECIES[primaryLanguage] ?? "generic";
}
