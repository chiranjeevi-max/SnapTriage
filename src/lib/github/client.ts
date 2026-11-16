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
  CommentPage,
  FetchCommentsOptions,
  IssueProvider,
  ProviderCollaborator,
  ProviderComment,
  ProviderIssue,
  ProviderLabel,
} from "@/lib/provider-interface";
import { ProviderApiError } from "@/lib/provider-error";
import { providerLogger } from "@/lib/logger";

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  let res: Response | null = null;
  try {
    res = await fetch(url, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: { ...headers(token), ...init?.headers },
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res) throw new Error("GitHub request failed before receiving a response");
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

/**
 * Read one page number out of GitHub's `Link` header.
 *
 * GitHub pages issue comments oldest-first and only numbers the pages in this
 * header, so the newest page is discovered rather than computed.
 */
function linkedPage(linkHeader: string | null, relation: "last" | "prev" | "next"): number | null {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<[^>]*[?&]page=(\d+)[^>]*>\s*;\s*rel="(\w+)"/);
    if (match && match[2] === relation) return Number(match[1]);
  }
  return null;
}

/** Normalise a GitHub issue comment into the provider-neutral shape. */
function toProviderComment(raw: {
  id: number;
  body: string | null;
  user: { login: string; avatar_url: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
}): ProviderComment {
  return {
    id: String(raw.id),
    body: raw.body ?? "",
    author: raw.user?.login ?? null,
    authorAvatar: raw.user?.avatar_url ?? null,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
    // GitHub keeps generated timeline activity out of the comment stream
    // entirely, so anything returned here was typed by a person.
    isSystem: false,
    url: raw.html_url ?? null,
  };
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

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        providerLogger.warn(
          { status: res.status, owner, repo, page },
          "GitHub fetchIssues page failed"
        );
        throw new ProviderApiError(res.status, body, {
          provider: "github",
          operation: "fetchIssues",
          owner,
          repo,
        });
      }

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
    const checked = async (url: string, tok: string, init?: RequestInit): Promise<Response> => {
      const response = await ghFetch(url, tok, init);
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new ProviderApiError(response.status, body, {
          provider: "github",
          operation: "updateIssue",
          owner,
          repo,
        });
      }
      return response;
    };

    // Build the update payload
    if (changes.state) {
      await checked(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}`, token, {
        method: "PATCH",
        body: JSON.stringify({ state: changes.state }),
      });
    }

    if (changes.labels?.add?.length) {
      await checked(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/labels`, token, {
        method: "POST",
        body: JSON.stringify({ labels: changes.labels.add }),
      });
    }

    if (changes.labels?.remove?.length) {
      for (const label of changes.labels.remove) {
        await checked(
          `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`,
          token,
          { method: "DELETE" }
        );
      }
    }

    if (changes.assignees?.add?.length) {
      await checked(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/assignees`, token, {
        method: "POST",
        body: JSON.stringify({ assignees: changes.assignees.add }),
      });
    }

    if (changes.assignees?.remove?.length) {
      await checked(`${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/assignees`, token, {
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
    if (!userRes.ok) return null;
    const user = await userRes.json();

    const res = await ghFetch(
      `${GITHUB_API}/repos/${owner}/${repo}/collaborators/${user.login}/permission`,
      token
    );

    // 404 means the token cannot see this repository at all.
    if (res.status === 404) return null;
    if (!res.ok) return null;

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

  /**
   * Fetch one page of an issue's comments, oldest first.
   *
   * GitHub numbers comment pages ascending from the oldest, so "the newest
   * page" is only knowable from the `Link` header. Reading the newest page
   * therefore costs a probe: ask for page 1, learn the last page number, then
   * read that. A caller that supplies `since` skips the probe — the filtered
   * set is small and its *oldest* page already contains what changed, so one
   * request answers "anything new since X".
   *
   * @param options - Cursor from a previous call, optional `since` filter, page size.
   */
  async fetchComments(
    owner: string,
    repo: string,
    issueNumber: number,
    token: string,
    options: FetchCommentsOptions = {}
  ): Promise<CommentPage> {
    const requested = options.limit ?? 30;
    const perPage = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 100)
      : 30;
    const base = `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`;

    const readPage = async (page: number) => {
      const params = new URLSearchParams({ per_page: String(perPage), page: String(page) });
      if (options.since) params.set("since", options.since.toISOString());

      const res = await ghFetch(`${base}?${params}`, token);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ProviderApiError(res.status, body, {
          provider: "github",
          operation: "fetchComments",
          owner,
          repo,
        });
      }

      const raw = (await res.json()) as Parameters<typeof toProviderComment>[0][];
      const link = res.headers.get("link");
      return {
        comments: raw.map(toProviderComment),
        page,
        lastPage: linkedPage(link, "last"),
        hasNext: linkedPage(link, "next") !== null,
      };
    };

    if (options.cursor) {
      const page = Number(options.cursor);
      if (!Number.isInteger(page) || page < 1) {
        throw new ProviderApiError(400, "Invalid comment cursor", {
          provider: "github",
          operation: "fetchComments",
          owner,
          repo,
        });
      }
      const current = await readPage(page);
      return { comments: current.comments, olderCursor: page > 1 ? String(page - 1) : null };
    }

    if (options.since) {
      // A filtered set can still span pages: thirty of the user's own comments
      // after the baseline would otherwise hide the reply that follows them. The
      // cursor is reported from the same response, so this costs one request.
      const first = await readPage(1);
      return { comments: first.comments, olderCursor: first.hasNext ? "2" : null };
    }

    const probe = await readPage(1);
    if (!probe.lastPage || probe.lastPage === 1) {
      return { comments: probe.comments, olderCursor: null };
    }

    const newest = await readPage(probe.lastPage);
    return { comments: newest.comments, olderCursor: String(probe.lastPage - 1) };
  },

  /**
   * Post a comment on an issue.
   *
   * @returns The comment as GitHub stored it, including its id.
   */
  async createComment(
    owner: string,
    repo: string,
    issueNumber: number,
    token: string,
    body: string
  ): Promise<ProviderComment> {
    const res = await ghFetch(
      `${GITHUB_API}/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
      token,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ProviderApiError(res.status, text, {
        provider: "github",
        operation: "createComment",
        owner,
        repo,
      });
    }

    return toProviderComment(await res.json());
  },

  /**
   * Resolve the login behind a GitHub token.
   *
   * @returns The authenticated login and avatar, or `null` when the token cannot
   *          read its own user (an installation token, for instance).
   */
  async getAuthenticatedUser(token: string) {
    const res = await ghFetch(`${GITHUB_API}/user`, token);
    if (!res.ok) return null;
    const user = await res.json();
    if (!user?.login) return null;
    return { login: user.login as string, avatar: (user.avatar_url as string) ?? null };
  },
};
