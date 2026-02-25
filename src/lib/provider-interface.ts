/** Raw issue data fetched from a provider API */
export interface ProviderIssue {
  providerIssueId: string;
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  authorAvatar: string | null;
  state: "open" | "closed";
  labels: string[];
  assignees: string[];
  url: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Changes to write back to the provider */
export interface IssueUpdate {
  labels?: { add?: string[]; remove?: string[] };
  assignees?: { add?: string[]; remove?: string[] };
  state?: "open" | "closed";
}

/** A label on a repo */
export interface ProviderLabel {
  name: string;
  color: string | null; // hex without #
  description: string | null;
}

/** A collaborator on a repo */
export interface ProviderCollaborator {
  username: string;
  avatar: string | null;
  permission: "admin" | "write" | "read";
}

/** Permission level on a repo */
export type RepoPermission = "admin" | "write" | "read";

/** Unified interface for GitHub and GitLab API clients */
export interface IssueProvider {
  /** Fetch issues from a repo, optionally since a given date */
  fetchIssues(owner: string, repo: string, token: string, since?: Date): Promise<ProviderIssue[]>;

  /** Update an issue on the provider (labels, assignees, state) */
  updateIssue(
    owner: string,
    repo: string,
    issueNumber: number,
    token: string,
    changes: IssueUpdate
  ): Promise<void>;

  /** Check the authenticated user's permission level on a repo */
  getRepoPermission(owner: string, repo: string, token: string): Promise<RepoPermission>;

  /** Fetch all labels for a repo */
  fetchLabels?(owner: string, repo: string, token: string): Promise<ProviderLabel[]>;

  /** Fetch collaborators for a repo */
  fetchCollaborators?(owner: string, repo: string, token: string): Promise<ProviderCollaborator[]>;
}
