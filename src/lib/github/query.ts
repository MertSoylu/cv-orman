export const USER_REPOS_QUERY = /* GraphQL */ `
  query UserRepos($login: String!, $after: String) {
    rateLimit { remaining cost limit }
    user(login: $login) {
      repositories(
        first: 100
        after: $after
        ownerAffiliations: OWNER
        isFork: false
        privacy: PUBLIC
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          name
          description
          url
          isArchived
          stargazerCount
          createdAt
          pushedAt
          primaryLanguage {
            name
          }
          defaultBranchRef {
            target {
              ... on Commit {
                history(first: 0) {
                  totalCount
                }
              }
            }
          }
        }
      }
    }
  }
`;
