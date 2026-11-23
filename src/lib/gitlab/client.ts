/**
 * @module gitlab/client
 *
 * GitLab REST API v4 implementation of the {@link IssueProvider} interface.
 *
 * Supports both gitlab.com and self-hosted instances via the `AUTH_GITLAB_URL`
 * environment variable. Uses `PRIVATE-TOKEN` header authentication.
 *
 * Key GitLab-specific behaviors:
 * - Label changes are sent as deltas (`add_labels` / `remove_labels`)
 * - Assignees are set as a full list of user IDs, resolved from usernames
 * - Access levels are numeric (30 = Developer/write, 40 = Maintainer/admin)
 */
import { z } from "zod";
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
import { REQUEST_TIMEOUT_MS } from "@/lib/provider-timing";

/**
 * Returns the GitLab instance base URL.
 * Defaults to `https://gitlab.com`; override with `AUTH_GITLAB_URL` for self-hosted.
 */
function getBaseUrl() {
  return process.env.AUTH_GITLAB_URL || "https://gitlab.com";
}

/**
 * Builds GitLab authentication headers using Private Token auth.
 * @param token - GitLab personal access token.
 */
function headers(token: string) {
  return { "PRIVATE-TOKEN": token };
}

/**
 * URL-encodes a GitLab project path ("owner/repo") for use in API URLs.
 * @param owner - Project namespace (user or group).
 * @param repo - Project name.
 * @returns Encoded project path string.
 */
function projectPath(owner: string, repo: string) {
  return encodeURIComponent(`${owner}/${repo}`);
}

/**
 * Abort fetches that hang against a provider.
 *
 * The signal stays live after the response headers arrive, so the body read that
 * follows is covered by the same deadline. Clearing the timer on the response
 * left `res.json()` unbounded: a provider that sent headers and then stalled held
 * the call open indefinitely, which for a publish means outliving the send-claim
 * lease that prevents a second one.
 *
 * The timer is therefore cleared by the caller once the body has been read. It is
 * attached to the response as `releaseTimeout` rather than cleared here.
 *
 * @param input - Request URL.
 * @param init - Optional request options.
 * @returns The response, with its timeout still armed.
 */
async function timedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(input, { ...init, signal: init?.signal ?? controller.signal });
    // `unref` keeps a pending timer from holding the process open on the server.
    (timeout as unknown as { unref?: () => void }).unref?.();
    return Object.assign(res, { releaseTimeout: () => clearTimeout(timeout) });
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

/**
 * Release a response whose body will not be read.
 *
 * Call this on every `!res.ok` early return that does not read the body.
 * Skipping it leaves the request's timer armed for its full duration, which
 * leaks one timer per failed call.
 *
 * @param res - A response returned by {@link timedFetch} that will not be read.
 */
function discard(res: Response): void {
  (res as unknown as { releaseTimeout?: () => void }).releaseTimeout?.();
  // Releasing the timer is not enough: an unread body holds the connection.
  // Draining it, rather than cancelling, is what returns it to the pool for reuse.
  if (!res.body) return;
  void (async () => {
    try {
      await res.arrayBuffer();
    } catch {
      // A body that cannot be read is already released; nothing to clean up.
    }
  })();
}

/**
 * Read a response body, then release the timer that guarded it.
 *
 * Every `timedFetch` response must go through this. Reading the body directly
 * leaves the timeout armed until it fires, which aborts a signal nobody is using
 * and keeps a timer alive for the rest of the request.
 *
 * @param res - A response returned by {@link timedFetch}.
 * @returns The parsed body.
 */
async function readJson<T>(res: Response): Promise<T> {
  const release = (res as unknown as { releaseTimeout?: () => void }).releaseTimeout;
  try {
    return (await res.json()) as T;
  } finally {
    release?.();
  }
}

/**
 * Read a failed response's body as text, then release its timer.
 *
 * An error path reads the body to quote it in {@link ProviderApiError}, which is
 * still a read: going through `res.text()` directly leaves one timer armed per
 * failed call, up to {@link REQUEST_TIMEOUT_MS}.
 *
 * @param res - A response returned by {@link timedFetch}.
 * @returns The body, or an empty string when it cannot be read.
 */
async function readText(res: Response): Promise<string> {
  const release = (res as unknown as { releaseTimeout?: () => void }).releaseTimeout;
  try {
    return await res.text();
  } catch {
    return "";
  } finally {
    release?.();
  }
}

/** The fields this client reads from a GitLab user, on issues and in user search alike. */
const gitlabUserSchema = z.object({ id: z.number(), username: z.string() });

/** The part of a GitLab issue that assignee updates are computed from. */
const issueAssigneesSchema = z.object({ assignees: z.array(gitlabUserSchema) });

/** Normalise a GitLab note into the provider-neutral shape. */
function toProviderComment(raw: {
  id: number;
  body: string;
  author?: { username: string; avatar_url: string | null } | null;
  created_at: string;
  updated_at: string;
  system?: boolean;
}): ProviderComment {
  return {
    id: String(raw.id),
    body: raw.body ?? "",
    author: raw.author?.username ?? null,
    authorAvatar: raw.author?.avatar_url ?? null,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
    // GitLab returns generated activity in the same stream as comments, unlike
    // GitHub. The flag is what keeps "added label bug" out of the follow-up
    // check; the request also asks for comments only, so this is belt and brace.
    isSystem: raw.system === true,
    url: null,
  };
}

/** GitLab implementation of the {@link IssueProvider} interface. */
export const gitlabProvider: IssueProvider = {
  /**
   * Fetches all issues from a GitLab project.
   * Note: GitLab uses `iid` (internal ID) as the user-visible issue number,
   * and `state: "opened"` rather than `"open"`.
   * @param owner - Project namespace.
   * @param repo - Project name.
   * @param token - GitLab auth token.
   * @param since - Optional date to filter issues updated after.
   * @returns Array of normalized provider issues.
   */
  async fetchIssues(owner, repo, token, since) {
    const baseUrl = getBaseUrl();
    const project = projectPath(owner, repo);
    const issues: ProviderIssue[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        state: "all",
        per_page: "100",
        page: String(page),
        order_by: "updated_at",
        sort: "desc",
      });
      if (since) params.set("updated_after", since.toISOString());

      const res = await timedFetch(`${baseUrl}/api/v4/projects/${project}/issues?${params}`, {
        headers: headers(token),
      });

      if (!res.ok) {
        const body = await readText(res);
        providerLogger.warn(
          { status: res.status, owner, repo, page },
          "GitLab fetchIssues page failed"
        );
        throw new ProviderApiError(res.status, body, {
          provider: "gitlab",
          operation: "fetchIssues",
          owner,
          repo,
        });
      }

      const data = await readJson<
        Array<{
          id: number;
          iid: number;
          title: string;
          description: string | null;
          author?: { username: string; avatar_url: string | null } | null;
          state: string;
          labels?: string[];
          assignees?: Array<{ username: string }> | null;
          web_url: string;
          created_at: string;
          updated_at: string;
        }>
      >(res);
      if (data.length === 0) break;

      for (const item of data) {
        issues.push({
          providerIssueId: String(item.id),
          number: item.iid,
          title: item.title,
          body: item.description,
          author: item.author?.username ?? null,
          authorAvatar: item.author?.avatar_url ?? null,
          state: item.state === "opened" ? "open" : "closed",
          labels: item.labels ?? [],
          assignees: (item.assignees ?? []).map((a: { username: string }) => a.username),
          url: item.web_url,
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
   * Applies triage changes to a GitLab issue.
   * Label changes go out as `add_labels` / `remove_labels`, which GitLab applies
   * to the issue's labels as they are when the update lands. Assignees have no
   * such delta: `assignee_ids` replaces the whole list, so it is rebuilt from
   * the issue, and a username that cannot be resolved fails the update rather
   * than being dropped from it.
   * @param owner - Project namespace.
   * @param repo - Project name.
   * @param issueNumber - The issue IID on GitLab.
   * @param token - GitLab auth token.
   * @param changes - The set of changes to apply.
   */
  async updateIssue(owner, repo, issueNumber, token, changes) {
    const baseUrl = getBaseUrl();
    const issueUrl = `${baseUrl}/api/v4/projects/${projectPath(owner, repo)}/issues/${issueNumber}`;
    const context = { provider: "gitlab", operation: "updateIssue", owner, repo };
    const params: Record<string, string> = {};

    // GitLab reads label lists as comma-separated, so a comma would split one name in two.
    const labelNames = [...(changes.labels?.add ?? []), ...(changes.labels?.remove ?? [])];
    if (labelNames.some((name) => name.includes(","))) {
      throw new Error("GitLab label names cannot contain commas");
    }

    if (changes.state) {
      params.state_event = changes.state === "open" ? "reopen" : "close";
    }

    if (changes.labels?.add?.length) params.add_labels = changes.labels.add.join(",");
    if (changes.labels?.remove?.length) params.remove_labels = changes.labels.remove.join(",");

    const assignees = changes.assignees;
    if (assignees && (assignees.add?.length || assignees.remove?.length)) {
      const issueRes = await timedFetch(issueUrl, { headers: headers(token) });
      if (!issueRes.ok) {
        const body = await readText(issueRes);
        throw new ProviderApiError(issueRes.status, body, context);
      }
      const current = issueAssigneesSchema.safeParse(await readJson<unknown>(issueRes));
      if (!current.success) throw new Error("GitLab returned an issue in an unexpected shape");

      // Current assignees come with their ids; only added usernames are looked up.
      const ids = new Map(current.data.assignees.map((user) => [user.username, user.id]));
      for (const username of assignees.remove ?? []) ids.delete(username);
      for (const username of assignees.add ?? []) {
        if (ids.has(username)) continue;

        const userRes = await timedFetch(
          `${baseUrl}/api/v4/users?username=${encodeURIComponent(username)}`,
          { headers: headers(token) }
        );
        if (!userRes.ok) {
          const body = await readText(userRes);
          throw new ProviderApiError(userRes.status, body, context);
        }
        const found = z.array(gitlabUserSchema).safeParse(await readJson<unknown>(userRes));
        if (!found.success) throw new Error("GitLab returned a user search in an unexpected shape");
        const [user] = found.data;
        if (!user) throw new Error(`GitLab has no user named ${username}`);
        ids.set(username, user.id);
      }
      params.assignee_ids = [...ids.values()].join(",");
    }

    if (Object.keys(params).length > 0) {
      const updateRes = await timedFetch(issueUrl, {
        method: "PUT",
        headers: {
          ...headers(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });
      if (!updateRes.ok) {
        const body = await readText(updateRes);
        throw new ProviderApiError(updateRes.status, body, context);
      }
    }
  },

  /**
   * Resolves the authenticated user's permission level on a GitLab project.
   * Uses the maximum of project-level and group-level access.
   * GitLab access levels: 10=Guest, 20=Reporter, 30=Developer, 40=Maintainer, 50=Owner.
   * @param owner - Project namespace.
   * @param repo - Project name.
   * @param token - GitLab auth token.
   * @returns The user's permission: "admin" (>=40), "write" (>=30), or "read".
   */
  async getRepoPermission(owner, repo, token) {
    const baseUrl = getBaseUrl();
    const project = projectPath(owner, repo);

    const res = await timedFetch(`${baseUrl}/api/v4/projects/${project}`, {
      headers: headers(token),
    });

    // 404 means the token cannot see this project at all.
    if (!res.ok) {
      discard(res);
      return null;
    }

    const data = await readJson<{
      permissions?: {
        project_access?: { access_level?: number } | null;
        group_access?: { access_level?: number } | null;
      } | null;
    }>(res);
    const accessLevel = data.permissions?.project_access?.access_level ?? 0;
    const groupLevel = data.permissions?.group_access?.access_level ?? 0;
    const maxLevel = Math.max(accessLevel, groupLevel);

    if (maxLevel >= 40) return "admin";
    if (maxLevel >= 30) return "write";
    return "read";
  },

  /**
   * Fetches all labels defined on a GitLab project.
   * Strips the leading `#` from color values for consistency with GitHub.
   * @param owner - Project namespace.
   * @param repo - Project name.
   * @param token - GitLab auth token.
   * @returns Array of labels with name, color (hex without #), and description.
   */
  async fetchLabels(owner, repo, token): Promise<ProviderLabel[]> {
    const baseUrl = getBaseUrl();
    const project = projectPath(owner, repo);
    const labels: ProviderLabel[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({ per_page: "100", page: String(page) });
      const res = await timedFetch(`${baseUrl}/api/v4/projects/${project}/labels?${params}`, {
        headers: headers(token),
      });
      if (!res.ok) {
        discard(res);
        break;
      }

      const data =
        await readJson<Array<{ name: string; color?: string | null; description?: string | null }>>(
          res
        );
      if (data.length === 0) break;

      for (const item of data) {
        labels.push({
          name: item.name,
          color: item.color ? item.color.replace(/^#/, "") : null,
          description: item.description ?? null,
        });
      }

      page++;
      if (data.length < 100) break;
    }

    return labels;
  },

  /**
   * Fetches all members (including inherited) of a GitLab project.
   * Uses the `/members/all` endpoint to include group-inherited members.
   * @param owner - Project namespace.
   * @param repo - Project name.
   * @param token - GitLab auth token.
   * @returns Array of collaborators with username, avatar, and permission.
   */
  async fetchCollaborators(owner, repo, token): Promise<ProviderCollaborator[]> {
    const baseUrl = getBaseUrl();
    const project = projectPath(owner, repo);
    const collaborators: ProviderCollaborator[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({ per_page: "100", page: String(page) });
      const res = await timedFetch(`${baseUrl}/api/v4/projects/${project}/members/all?${params}`, {
        headers: headers(token),
      });
      if (!res.ok) {
        discard(res);
        break;
      }

      const data =
        await readJson<
          Array<{ access_level: number; username: string; avatar_url?: string | null }>
        >(res);
      if (data.length === 0) break;

      for (const item of data) {
        const accessLevel = item.access_level;
        let permission: "admin" | "write" | "read" = "read";
        if (accessLevel >= 40) permission = "admin";
        else if (accessLevel >= 30) permission = "write";

        collaborators.push({
          username: item.username,
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
   * Fetch one page of an issue's notes, oldest first.
   *
   * GitLab's notes endpoint mixes human comments with generated activity and
   * lets the caller filter: `activity_filter=only_comments` drops system notes
   * server-side, which keeps the payload small and means a thread of pure
   * label changes reads as empty rather than as a conversation.
   *
   * Pages are requested newest-first, so page 1 is the most recent activity and
   * the cursor walks towards older history exactly as it does for GitHub. Each
   * page is then reversed before it is returned, because both providers hand
   * the caller "oldest first within the page" — a thread should read in the
   * order it was written no matter which way the API paged it.
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
    const baseUrl = getBaseUrl();
    const project = projectPath(owner, repo);
    const requested = options.limit ?? 30;
    const perPage = Number.isFinite(requested)
      ? Math.min(Math.max(Math.trunc(requested), 1), 100)
      : 30;

    const page = options.cursor ? Number(options.cursor) : 1;
    if (!Number.isInteger(page) || page < 1) {
      throw new ProviderApiError(400, "Invalid comment cursor", {
        provider: "gitlab",
        operation: "fetchComments",
        owner,
        repo,
      });
    }

    const params = new URLSearchParams({
      per_page: String(perPage),
      page: String(page),
      sort: "desc",
      order_by: "created_at",
      activity_filter: "only_comments",
    });
    if (options.since) params.set("updated_after", options.since.toISOString());

    const res = await timedFetch(
      `${baseUrl}/api/v4/projects/${project}/issues/${issueNumber}/notes?${params}`,
      { headers: headers(token) }
    );

    if (!res.ok) {
      const body = await readText(res);
      throw new ProviderApiError(res.status, body, {
        provider: "gitlab",
        operation: "fetchComments",
        owner,
        repo,
      });
    }

    const raw = await readJson<Parameters<typeof toProviderComment>[0][]>(res);
    // The header carries the page number GitLab wants next; use its value rather
    // than assuming contiguity, so a server that skips a page is followed.
    const nextPage = res.headers.get("x-next-page");

    return {
      comments: raw
        .filter((note) => note.system !== true)
        .map(toProviderComment)
        .reverse(),
      olderCursor: nextPage ? nextPage : null,
    };
  },

  /**
   * Post a comment on an issue.
   *
   * GitLab normalises the body before storing it: quick actions are executed
   * and removed, carriage returns are stripped, and trailing whitespace is
   * trimmed. The returned comment is therefore what GitLab kept, not
   * necessarily what was sent, which is why the caller stores the response.
   *
   * @returns The note as GitLab stored it, including its id.
   */
  async createComment(
    owner: string,
    repo: string,
    issueNumber: number,
    token: string,
    body: string
  ): Promise<ProviderComment> {
    const baseUrl = getBaseUrl();
    const project = projectPath(owner, repo);

    const res = await timedFetch(
      `${baseUrl}/api/v4/projects/${project}/issues/${issueNumber}/notes`,
      {
        method: "POST",
        headers: { ...headers(token), "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }
    );

    if (!res.ok) {
      const text = await readText(res);
      throw new ProviderApiError(res.status, text, {
        provider: "gitlab",
        operation: "createComment",
        owner,
        repo,
      });
    }

    return toProviderComment(await readJson<Parameters<typeof toProviderComment>[0]>(res));
  },

  /**
   * Resolve the username behind a GitLab token.
   *
   * @returns The authenticated username and avatar, or `null`.
   */
  async getAuthenticatedUser(token: string) {
    const res = await timedFetch(`${getBaseUrl()}/api/v4/user`, { headers: headers(token) });
    if (!res.ok) {
      discard(res);
      return null;
    }
    const user = await readJson<{ username?: string; avatar_url?: string | null }>(res);
    if (!user?.username) return null;
    return { login: user.username as string, avatar: (user.avatar_url as string) ?? null };
  },
};
