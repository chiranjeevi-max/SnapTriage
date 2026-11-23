/**
 * @module repos/fetch-available-repos
 *
 * Fetches the list of repositories accessible to a user from GitHub or GitLab.
 * Used by the "Add Repository" UI to let users browse and connect repos.
 *
 * Each provider-specific function paginates through all accessible repos
 * and normalizes them into the {@link AvailableRepo} shape.
 */
import { REQUEST_TIMEOUT_MS } from "@/lib/provider-timing";

/**
 * Bound a provider read, including its body.
 *
 * The timer is cleared once the body is read, not when the headers arrive: a
 * provider that sends headers and then stalls would otherwise leave `res.json()`
 * with no deadline at all, holding the request open indefinitely.
 *
 * @param input - Request URL.
 * @param init - Optional request options.
 * @returns The response, with its timeout still armed.
 */
async function fetchWithTimeout(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(input, { ...init, signal: init?.signal ?? controller.signal });
    (timeout as unknown as { unref?: () => void }).unref?.();
    return Object.assign(res, { releaseTimeout: () => clearTimeout(timeout) });
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/** Read a response body, then release the timer that guarded it. */
async function readJson<T>(res: Response): Promise<T> {
  const release = (res as unknown as { releaseTimeout?: () => void }).releaseTimeout;
  try {
    return (await res.json()) as T;
  } finally {
    release?.();
  }
}

/** Release a response whose body will not be read, such as an error response. */
function discard(res: Response): void {
  (res as unknown as { releaseTimeout?: () => void }).releaseTimeout?.();
}

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

/** The part of a GitHub repository this module reads. */
interface GitHubRepoPayload {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  permissions?: { admin?: boolean; push?: boolean } | null;
  owner: { login: string };
}

/** The part of a GitLab project this module reads. */
interface GitLabProjectPayload {
  path: string;
  path_with_namespace: string;
  description: string | null;
  visibility?: string;
  namespace: { path: string } | null;
  permissions?: {
    project_access?: { access_level?: number } | null;
    group_access?: { access_level?: number } | null;
  } | null;
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
    const res = await fetchWithTimeout(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      }
    );

    if (!res.ok) {
      discard(res);
      throw new Error(`Failed to fetch repositories (HTTP ${res.status})`);
    }

    const data = await readJson<GitHubRepoPayload[]>(res);
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
    const res = await fetchWithTimeout(
      `${baseUrl}/api/v4/projects?membership=true&per_page=100&page=${page}&order_by=updated_at`,
      {
        headers: { "PRIVATE-TOKEN": token },
      }
    );

    if (!res.ok) {
      discard(res);
      throw new Error(`Failed to fetch repositories (HTTP ${res.status})`);
    }

    const data = await readJson<GitLabProjectPayload[]>(res);
    if (data.length === 0) break;

    for (const project of data) {
      // GitLab access levels: 10=guest, 20=reporter, 30=developer, 40=maintainer, 50=owner
      const accessLevel = project.permissions?.project_access?.access_level ?? 0;
      const groupLevel = project.permissions?.group_access?.access_level ?? 0;
      const maxLevel = Math.max(accessLevel, groupLevel);

      let permission: "admin" | "write" | "read" = "read";
      if (maxLevel >= 40) permission = "admin";
      else if (maxLevel >= 30) permission = "write";

      // `namespace` is absent on a project the token can no longer see in full,
      // which would make this loop throw and drop every page already read. The
      // full path always carries the owner, and everything before the last
      // segment is it — taking only the first segment would turn `group/sub/app`
      // into `group`, which is not a project the connect flow can resolve.
      const owner =
        project.namespace?.path ?? project.path_with_namespace.split("/").slice(0, -1).join("/");

      repos.push({
        provider: "gitlab",
        owner,
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
