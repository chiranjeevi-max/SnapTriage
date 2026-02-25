import type {
  IssueProvider,
  ProviderIssue,
  ProviderLabel,
  ProviderCollaborator,
} from "@/lib/provider-interface";

function getBaseUrl() {
  return process.env.AUTH_GITLAB_URL || "https://gitlab.com";
}

function headers(token: string) {
  return { "PRIVATE-TOKEN": token };
}

/** Encode owner/repo as GitLab project path */
function projectPath(owner: string, repo: string) {
  return encodeURIComponent(`${owner}/${repo}`);
}

export const gitlabProvider: IssueProvider = {
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
