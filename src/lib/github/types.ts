export interface GitHubRepoNode {
  id: string;
  name: string;
  description: string | null;
  url: string;
  isArchived: boolean;
  stargazerCount: number;
  createdAt: string;
  pushedAt: string;
  primaryLanguage: { name: string } | null;
  defaultBranchRef: {
    target: {
      history: { totalCount: number };
    } | null;
  } | null;
}

export interface GitHubReposResponse {
  data?: {
    rateLimit?: { remaining: number; cost: number; limit: number };
    user: {
      repositories: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: GitHubRepoNode[];
      };
    } | null;
  };
  errors?: Array<{ message: string }>;
}
