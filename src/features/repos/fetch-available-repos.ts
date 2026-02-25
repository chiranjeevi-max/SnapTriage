/**
 * @module repos/fetch-available-repos
 *
 * Fetches the list of repositories accessible to a user from GitHub or GitLab.
 * Used by the "Add Repository" UI to let users browse and connect repos.
 *
 * Each provider-specific function paginates through all accessible repos
 * and normalizes them into the {@link AvailableRepo} shape.
 */

/** Normalized repository data returned by the provider-specific fetch functions. */
export interface AvailableRepo {
  provider: "github" | "gitlab";
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  permission: "admin" | "write" | "read";
  isPrivate: boolean;
}

/**
 * Fetches all repositories accessible to the user from GitHub.
 * Maps GitHub's `permissions.admin/push` flags to "admin"/"write"/"read".
 * @param token - GitHub auth token.
 * @returns Normalized list of available repos.
 */
export async function fetchGitHubRepos(token: string): Promise<AvailableRepo[]> {
  const repos: AvailableRepo[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!res.ok) break;

    const data = await res.json();
    if (data.length === 0) break;

    for (const repo of data) {
      let permission: "admin" | "write" | "read" = "read";
      if (repo.permissions?.admin) permission = "admin";
      else if (repo.permissions?.push) permission = "write";

      repos.push({
        provider: "github",
        owner: repo.owner.login,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        permission,
        isPrivate: repo.private,
      });
    }

    page++;
    if (data.length < 100) break;
  }

  return repos;
}

/**
 * Fetches all projects accessible to the user from GitLab.
 * Maps GitLab's numeric access levels to "admin"/"write"/"read".
 * @param token - GitLab auth token.
 * @returns Normalized list of available repos.
 */
export async function fetchGitLabRepos(token: string): Promise<AvailableRepo[]> {
  const baseUrl = process.env.AUTH_GITLAB_URL || "https://gitlab.com";
  const repos: AvailableRepo[] = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `${baseUrl}/api/v4/projects?membership=true&per_page=100&page=${page}&order_by=updated_at`,
      {
        headers: { "PRIVATE-TOKEN": token },
      }
    );

    if (!res.ok) break;

    const data = await res.json();
    if (data.length === 0) break;

    for (const project of data) {
      // GitLab access levels: 10=guest, 20=reporter, 30=developer, 40=maintainer, 50=owner
      const accessLevel = project.permissions?.project_access?.access_level ?? 0;
      const groupLevel = project.permissions?.group_access?.access_level ?? 0;
      const maxLevel = Math.max(accessLevel, groupLevel);

      let permission: "admin" | "write" | "read" = "read";
      if (maxLevel >= 40) permission = "admin";
      else if (maxLevel >= 30) permission = "write";

      repos.push({
        provider: "gitlab",
        owner: project.namespace.path,
        name: project.path,
        fullName: project.path_with_namespace,
        description: project.description,
        permission,
        isPrivate: project.visibility === "private",
      });
    }

    page++;
    if (data.length < 100) break;
  }

  return repos;
}

/**
 * Dispatches to the correct provider-specific repo fetcher.
 * @param token - Auth token for the provider.
 * @param provider - Which provider to fetch from.
 * @returns Normalized list of available repos.
 */
export async function fetchAvailableRepos(
  token: string,
  provider: "github" | "gitlab"
): Promise<AvailableRepo[]> {
  if (provider === "github") return fetchGitHubRepos(token);
  if (provider === "gitlab") return fetchGitLabRepos(token);
  return [];
}
