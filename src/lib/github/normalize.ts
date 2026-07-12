import { computeGrowthScore } from "@/lib/forest/growth";
import { computeHealthStage } from "@/lib/forest/health";
import { mapLanguageToSpecies } from "@/lib/forest/species";
import type { TreeData } from "@/lib/forest/treeData";
import type { GitHubRepoNode } from "@/lib/github/types";

function normalizeRepoNode(repo: GitHubRepoNode): TreeData {
  // defaultBranchRef is null for empty/disabled-default-branch repos.
  const commitCount = repo.defaultBranchRef?.target?.history?.totalCount ?? 0;
  const primaryLanguage = repo.primaryLanguage?.name ?? null;
  const stars = Number.isFinite(repo.stargazerCount)
    ? repo.stargazerCount
    : 0;

  return {
    id: repo.id,
    name: repo.name,
    description: repo.description,
    url: repo.url,
    primaryLanguage,
    species: mapLanguageToSpecies(primaryLanguage),
    stars,
    commitCount,
    createdAt: repo.createdAt,
    lastPushedAt: repo.pushedAt,
    growthScore: computeGrowthScore({
      stars,
      commitCount,
      createdAt: repo.createdAt,
    }),
    healthStage: computeHealthStage(repo.pushedAt),
  };
}

/**
 * isFork is filtered server-side by the GraphQL query's `isFork: false`
 * argument, but `repositories()` has no equivalent `isArchived` argument —
 * archived repos must be dropped here instead.
 */
export function normalizeRepoNodes(nodes: GitHubRepoNode[]): TreeData[] {
  return nodes.filter((repo) => repo.isArchived !== true).map(normalizeRepoNode);
}
