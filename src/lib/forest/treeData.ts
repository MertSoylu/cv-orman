export type Species =
  | "oak"
  | "pine"
  | "sakura"
  | "palm"
  | "birch"
  | "willow"
  | "redwood"
  | "generic";

export interface TreeData {
  id: string;
  name: string;
  description: string | null;
  url: string;
  primaryLanguage: string | null;
  species: Species;
  stars: number;
  commitCount: number;
  createdAt: string;
  lastPushedAt: string;
  /** 0-1, precomputed. Drives scale. Never below growth.MIN_GROWTH_FLOOR. */
  growthScore: number;
  /** 0-1, precomputed. Drives color/foliage. Never below health.WILTED_FLOOR. */
  healthStage: number;
}

/** Position assigned by lib/forest/layout.ts, attached before a TreeData reaches any renderer. */
export interface PlacedTreeData extends TreeData {
  x: number;
  y: number;
}
