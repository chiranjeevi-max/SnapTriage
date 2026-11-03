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
  IssueProvider,
  ProviderIssue,
  ProviderLabel,
  ProviderCollaborator,
} from "@/lib/provider-interface";
import { ProviderApiError } from "@/lib/provider-error";
import { providerLogger } from "@/lib/logger";

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

/** Abort fetches that hang against a provider. */
async function timedFetch(input: RequestInfo, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    return await fetch(input, { ...init, signal: init?.signal ?? controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

/** The fields this client reads from a GitLab user, on issues and in user search alike. */
const gitlabUserSchema = z.object({ id: z.number(), username: z.string() });

/** The part of a GitLab issue that assignee updates are computed from. */
const issueAssigneesSchema = z.object({ assignees: z.array(gitlabUserSchema) });

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
        const body = await res.text().catch(() => "");
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

      const data = await res.json();
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
        const body = await issueRes.text().catch(() => "");
        throw new ProviderApiError(issueRes.status, body, context);
      }
      const current = issueAssigneesSchema.safeParse(await issueRes.json());
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
          const body = await userRes.text().catch(() => "");
          throw new ProviderApiError(userRes.status, body, context);
        }
        const found = z.array(gitlabUserSchema).safeParse(await userRes.json());
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
        const body = await updateRes.text().catch(() => "");
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
    if (res.status === 404) return null;
    if (!res.ok) return null;

    const data = await res.json();
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
      if (!res.ok) break;

      const data = await res.json();
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
      if (!res.ok) break;

      const data = await res.json();
      if (data.length === 0) break;

      for (const item of data) {
        const accessLevel = item.access_level as number;
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
};
