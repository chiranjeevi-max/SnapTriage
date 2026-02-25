/**
 * @module gitlab/client
 *
 * GitLab REST API v4 implementation of the {@link IssueProvider} interface.
 *
 * Supports both gitlab.com and self-hosted instances via the `AUTH_GITLAB_URL`
 * environment variable. Uses `PRIVATE-TOKEN` header authentication.
 *
 * Key GitLab-specific behaviors:
 * - Labels are replaced in full (not added/removed individually)
 * - Assignees require user ID resolution from usernames
 * - Access levels are numeric (30 = Developer/write, 40 = Maintainer/admin)
 */
import type {
  IssueProvider,
  ProviderIssue,
  ProviderLabel,
  ProviderCollaborator,
} from "@/lib/provider-interface";

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

      const res = await fetch(`${baseUrl}/api/v4/projects/${project}/issues?${params}`, {
        headers: headers(token),
      });

      if (!res.ok) break;

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
   * Unlike GitHub, GitLab requires full label replacement and user ID resolution
   * for assignees, so this method fetches current issue state before updating.
   * @param owner - Project namespace.
   * @param repo - Project name.
   * @param issueNumber - The issue IID on GitLab.
   * @param token - GitLab auth token.
   * @param changes - The set of changes to apply.
   */
  async updateIssue(owner, repo, issueNumber, token, changes) {
    const baseUrl = getBaseUrl();
    const project = projectPath(owner, repo);
    const params: Record<string, string> = {};

    if (changes.state) {
      params.state_event = changes.state === "open" ? "reopen" : "close";
    }

    // GitLab sets labels as a full replacement, so we need to fetch current labels first
    if (changes.labels?.add?.length || changes.labels?.remove?.length) {
      const issueRes = await fetch(`${baseUrl}/api/v4/projects/${project}/issues/${issueNumber}`, {
        headers: headers(token),
      });

      if (issueRes.ok) {
        const issue = await issueRes.json();
        const currentLabels: string[] = issue.labels ?? [];
        const newLabels = new Set(currentLabels);
        for (const l of changes.labels?.add ?? []) newLabels.add(l);
        for (const l of changes.labels?.remove ?? []) newLabels.delete(l);
        params.labels = Array.from(newLabels).join(",");
      }
    }

    if (changes.assignees?.add?.length || changes.assignees?.remove?.length) {
      // GitLab uses user IDs for assignees — for simplicity, we fetch user IDs by username
      // This is a simplified approach; a full implementation would cache user IDs
      const currentAssigneeIds: number[] = [];

      const issueRes = await fetch(`${baseUrl}/api/v4/projects/${project}/issues/${issueNumber}`, {
        headers: headers(token),
      });

      if (issueRes.ok) {
        const issue = await issueRes.json();
        const existingAssignees = new Set<string>(
          (issue.assignees ?? []).map((a: { username: string }) => a.username)
        );
        for (const u of changes.assignees?.remove ?? []) existingAssignees.delete(u);
        for (const u of changes.assignees?.add ?? []) existingAssignees.add(u);

        // Resolve usernames to IDs
        for (const username of existingAssignees) {
          const userRes = await fetch(
            `${baseUrl}/api/v4/users?username=${encodeURIComponent(username)}`,
            { headers: headers(token) }
          );
          if (userRes.ok) {
            const users = await userRes.json();
            if (users.length > 0) currentAssigneeIds.push(users[0].id);
          }
        }
        params.assignee_ids = currentAssigneeIds.join(",");
      }
    }

    if (Object.keys(params).length > 0) {
      await fetch(`${baseUrl}/api/v4/projects/${project}/issues/${issueNumber}`, {
        method: "PUT",
        headers: {
          ...headers(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(params),
      });
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

    const res = await fetch(`${baseUrl}/api/v4/projects/${project}`, {
      headers: headers(token),
    });

    if (!res.ok) return "read";

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
      const res = await fetch(`${baseUrl}/api/v4/projects/${project}/labels?${params}`, {
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
      const res = await fetch(`${baseUrl}/api/v4/projects/${project}/members/all?${params}`, {
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
