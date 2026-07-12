import { REVALIDATE_SECONDS, getGithubToken, getGithubUsername } from "@/lib/config";
import { USER_REPOS_QUERY } from "@/lib/github/query";
import type { GitHubRepoNode, GitHubReposResponse } from "@/lib/github/types";

const GITHUB_GRAPHQL_URL = "https://api.github.com/graphql";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 50;

export class GitHubFetchError extends Error {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPageRaw(
  after: string | null,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(GITHUB_GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${getGithubToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: USER_REPOS_QUERY,
      variables: { login: getGithubUsername(), after },
    }),
    next: { revalidate: REVALIDATE_SECONDS },
    signal,
  });
}

async function fetchPage(after: string | null): Promise<GitHubReposResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= 2; attempt++) {
    if (attempt > 0) {
      await sleep(attempt === 1 ? 500 : 1500);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

    try {
      const res = await fetchPageRaw(after, controller.signal);

      if (!res.ok) {
        const message = `GitHub GraphQL request failed: ${res.status} ${res.statusText}`;
        if (res.status >= 500 && res.status < 600) {
          lastError = new GitHubFetchError(message);
          continue;
        }
        throw new GitHubFetchError(message);
      }

      let json: GitHubReposResponse;
      try {
        json = (await res.json()) as GitHubReposResponse;
      } catch {
        throw new GitHubFetchError(
          "GitHub GraphQL returned non-JSON response (possible rate limit or CDN wall)",
        );
      }

      return json;
    } catch (err) {
      if (err instanceof GitHubFetchError) {
        throw err;
      }

      const isAbort =
        err instanceof Error &&
        (err.name === "AbortError" || err.message.includes("aborted"));

      if (isAbort) {
        lastError = new GitHubFetchError(
          `GitHub GraphQL request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`,
        );
        continue;
      }

      lastError = new GitHubFetchError(
        `GitHub GraphQL request failed: ${err instanceof Error ? err.message : "network error"}`,
      );
      continue;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError;
}

/** Fetches every owned, non-fork, public repo node across all pages. */
export async function fetchAllRepoNodes(): Promise<GitHubRepoNode[]> {
  const nodes: GitHubRepoNode[] = [];
  let after: string | null = null;
  let hasNextPage = true;
  let pages = 0;

  while (hasNextPage) {
    if (pages >= MAX_PAGES) {
      throw new GitHubFetchError(
        "GitHub pagination exceeded 50 pages — aborting",
      );
    }

    const json = await fetchPage(after);
    pages++;

    if (json.errors?.length) {
      throw new GitHubFetchError(
        `GitHub GraphQL returned errors: ${json.errors.map((e) => e.message).join("; ")}`,
      );
    }

    const repositories = json.data?.user?.repositories;
    if (!repositories) {
      throw new GitHubFetchError(
        "GitHub GraphQL returned no user/repositories — check GITHUB_USERNAME and GITHUB_TOKEN configuration.",
      );
    }

    nodes.push(...repositories.nodes);
    hasNextPage = repositories.pageInfo.hasNextPage;
    after = repositories.pageInfo.endCursor;
  }

  return nodes;
}