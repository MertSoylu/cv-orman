import type { GitHubRepoNode } from "@/lib/github/types";

const LANGUAGES = [
  "TypeScript", "Rust", "Python", "Go", "HTML", "PHP", "Swift", "Shell",
  "JavaScript", "C++", "Ruby", "Kotlin", "CSS", "Lua", "Dart", null,
];
const NAMES = [
  "cv-orman", "portfolio", "pixel-forge", "net-scout", "aurora-ui", "kotlin-notes", "tiny-llm",
  "dotfiles", "packet-lab", "rustboy", "leafdb", "moonbase", "ci-recipes", "vault-cli", "ink-reader",
  "geo-tiles", "sandbox.js", "old_blog", "quiz-app", "wave-synth", "paperboy", "glacier", "hx-tools", "zen-timer",
];

/**
 * Deterministic stand-in for the GitHub response, used only when `FOREST_MOCK`
 * is set (its value is the repo count). The scene is a visual product and
 * cannot be judged from an error card, so working on it must not depend on
 * having a token to hand.
 */
export function mockRepoNodes(count: number): GitHubRepoNode[] {
  const day = 86_400_000;
  const now = Date.now();
  return Array.from({ length: count }, (_, i) => {
    const h = (n: number) => {
      const v = Math.sin((i + 1) * 12.9898 + n * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    return {
      id: `mock-${String(i).padStart(3, "0")}`,
      name: NAMES[i % NAMES.length] + (i >= NAMES.length ? `-${Math.floor(i / NAMES.length) + 1}` : ""),
      description: "Mock repository for working on the scene without a GitHub token.",
      url: "https://github.com",
      isArchived: false,
      stargazerCount: Math.floor(Math.pow(h(1), 3) * 420),
      createdAt: new Date(now - (60 + h(2) * 1500) * day).toISOString(),
      pushedAt: new Date(now - Math.pow(h(3), 1.6) * 170 * day).toISOString(),
      primaryLanguage: LANGUAGES[i % LANGUAGES.length] ? { name: LANGUAGES[i % LANGUAGES.length] as string } : null,
      defaultBranchRef: { target: { history: { totalCount: Math.floor(4 + Math.pow(h(4), 2) * 900) } } },
    };
  });
}
