/**
 * @module github/client
 *
 * GitHub REST API v3 implementation of the {@link IssueProvider} interface.
 *
 * All requests go through {@link ghFetch}, which handles authentication headers
 * and automatic retry on rate-limit 403 responses. Pagination follows GitHub's
 * per_page=100 convention with sequential page fetching.
 */
import type {
  IssueProvider,
  ProviderIssue,
  ProviderLabel,
  ProviderCollaborator,
} from "@/lib/provider-interface";

/** GitHub REST API base URL. */
const GITHUB_API = "https://api.github.com";

/**
 * Builds standard GitHub API headers with Bearer auth and API versioning.
 * @param token - GitHub personal access token or OAuth token.
 * @returns Headers object ready for fetch().
 */
function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Sleep for a given number of milliseconds */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch wrapper with GitHub rate-limit awareness.
 * On a 403 with `x-ratelimit-remaining: 0`, waits until the reset window
 * (capped at 60 seconds) and retries once.
 * @param url - Fully-qualified GitHub API URL.
 * @param token - Authentication token.
 * @param init - Optional fetch RequestInit overrides.
 * @returns The fetch Response (original or retried).
 */
async function ghFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { ...headers(token), ...init?.headers } });

  if (res.status === 403) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    const resetAt = res.headers.get("x-ratelimit-reset");

    if (remaining === "0" && resetAt) {
      const waitMs = Math.max(0, Number(resetAt) * 1000 - Date.now()) + 1000;
      const cappedWait = Math.min(waitMs, 60_000); // cap at 60s
      await sleep(cappedWait);
      return fetch(url, { ...init, headers: { ...headers(token), ...init?.headers } });
    }
  }

  return res;
}

/** GitHub implementation of the {@link IssueProvider} interface. */
export const githubProvider: IssueProvider = {
  /**
   * Fetches all issues (excluding PRs) from a GitHub repository.
   * Paginates through all pages, sorted by most-recently-updated first.
   * @param owner - Repository owner (user or org).
   * @param repo - Repository name.
   * @param token - GitHub auth token.
   * @param since - Optional date to filter issues updated after.
   * @returns Array of normalized provider issues.
   */
  async fetchIssues(owner, repo, token, since) {
    const issues: ProviderIssue[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        state: "all",
        per_page: "100",
        page: String(page),
        sort: "updated",
        direction: "desc",
      });
      if (since) params.set("since", since.toISOString());

      const res = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/issues?${params}`, token);

      if (!res.ok) break;

      const data = await res.json();
      if (data.length === 0) break;

      for (const item of data) {
        // Skip pull requests (GitHub returns them in the issues endpoint)
        if (item.pull_request) continue;

        issues.push({
          providerIssueId: String(item.id),
          number: item.number,
          title: item.title,
          body: item.body,
          author: item.user?.login ?? null,
          authorAvatar: item.user?.avatar_url ?? null,
          state: item.state === "open" ? "open" : "closed",
          labels: (item.labels ?? []).map((l: { name: string }) => l.name),
          assignees: (item.assignees ?? []).map((a: { login: string }) => a.login),
          url: item.html_url,
          createdAt: new Date(item.created_at),
          updatedAt: new Date(item.updated_at),
        });
      }

      page++;
      if (data.length < 100) break;
    }

    return issues;
  },

  /**
   * Applies triage changes (state, labels, assignees) to a GitHub issue.
   * Each change type is sent as a separate API call because GitHub's
   * issues endpoint requires different HTTP methods per operation.
   * @param owner - Repository owner.
   * @param repo - Repository name.
   * @param issueNumber - The issue number on GitHub.
   * @param token - GitHub auth token.
   * @param changes - The set of changes to apply.
   */
  async updateIssue(owner, repo, issueNumber, token, changes) {
    // Build the update payload
    if (changes.state) {
      await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`, token, {
        method: "PATCH",
        body: JSON.stringify({ state: changes.state }),
      });
    }

    if (changes.labels?.add?.length) {
      await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/labels`, token, {
        method: "POST",
        body: JSON.stringify({ labels: changes.labels.add }),
      });
    }

    if (changes.labels?.remove?.length) {
      for (const label of changes.labels.remove) {
        await ghFetch(
          `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
          token,
          { method: "DELETE" }
        );
      }
    }

    if (changes.assignees?.add?.length) {
      await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/assignees`, token, {
        method: "POST",
        body: JSON.stringify({ assignees: changes.assignees.add }),
      });
    }

    if (changes.assignees?.remove?.length) {
      await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/assignees`, token, {
        method: "DELETE",
        body: JSON.stringify({ assignees: changes.assignees.remove }),
      });
    }
  },

  /**
   * Resolves the authenticated user's permission level on a repository.
   * Falls back to "read" if the API call fails (e.g., token lacks scope).
   * Maps GitHub's "maintain" role to "write" for simplicity.
   * @param owner - Repository owner.
   * @param repo - Repository name.
   * @param token - GitHub auth token.
   * @returns The user's permission: "admin", "write", or "read".
   */
  async getRepoPermission(owner, repo, token) {
    // Get authenticated user first
    const userRes = await ghFetch(`${GITHUB_API}/user`, token);
    if (!userRes.ok) return "read";
    const user = await userRes.json();

    const res = await ghFetch(
      `${GITHUB_API}/repos/${owner}/${repo}/collaborators/${user.login}/permission`,
      token
    );

    if (!res.ok) return "read";

    const data = await res.json();
    const perm = data.permission as string;

    if (perm === "admin") return "admin";
    if (perm === "write" || perm === "maintain") return "write";
    return "read";
  },

  /**
   * Fetches all labels defined on a GitHub repository.
   * Paginates through all pages (100 per page).
   * @param owner - Repository owner.
   * @param repo - Repository name.
   * @param token - GitHub auth token.
   * @returns Array of labels with name, color, and description.
   */
  async fetchLabels(owner, repo, token): Promise<ProviderLabel[]> {
    const labels: ProviderLabel[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({ per_page: "100", page: String(page) });
      const res = await ghFetch(`${GITHUB_API}/repos/${owner}/${repo}/labels?${params}`, token);
      if (!res.ok) break;

      const data = await res.json();
      if (data.length === 0) break;

      for (const item of data) {
        labels.push({
          name: item.name,
          color: item.color ?? null,
          description: item.description ?? null,
        });
      }

      page++;
      if (data.length < 100) break;
    }

    return labels;
  },

  /**
   * Fetches all collaborators on a GitHub repository.
   * Maps GitHub's `role_name` to the simplified "admin" | "write" | "read" scale.
   * @param owner - Repository owner.
   * @param repo - Repository name.
   * @param token - GitHub auth token.
   * @returns Array of collaborators with username, avatar, and permission.
   */
  async fetchCollaborators(owner, repo, token): Promise<ProviderCollaborator[]> {
    const collaborators: ProviderCollaborator[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({ per_page: "100", page: String(page) });
      const res = await ghFetch(
        `${GITHUB_API}/repos/${owner}/${repo}/collaborators?${params}`,
        token
      );
      if (!res.ok) break;

      const data = await res.json();
      if (data.length === 0) break;

      for (const item of data) {
        const perm = item.role_name as string;
        let permission: "admin" | "write" | "read" = "read";
        if (perm === "admin") permission = "admin";
        else if (perm === "write" || perm === "maintain") permission = "write";

        collaborators.push({
          username: item.login,
          avatar: item.avatar_url ?? null,
          permission,
        });
      }

      page++;
      if (data.length < 100) break;
    }

    return collaborators;
  },
};
