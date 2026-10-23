/**
 * @module provider-interface
 *
 * Defines the unified provider abstraction that decouples SnapTriage's core
 * logic from any specific Git hosting platform. Both the GitHub and GitLab
 * clients implement {@link IssueProvider} so the rest of the app can treat
 * them interchangeably.
 */

/** Raw issue data fetched from a provider API. */
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

/**
 * The limits the providers themselves enforce on the values SnapTriage sends.
 *
 * These are the providers' documented limits, not caps invented here. The app
 * validates against them at the boundary so a write is never attempted with a
 * value the provider will reject, and so a stored name is always a name the
 * provider can actually have.
 */
export const providerLimits = {
  github: {
    /** Maximum length of a user or organisation login. */
    owner: 39,
    /** Maximum length of a repository name. */
    name: 100,
    /** Maximum length of `owner/name`. */
    path: 140,
    /** Maximum length of a label name. */
    label: 50,
    /** Maximum length of a user login. */
    login: 39,
  },
  gitlab: {
    /** Maximum length of a namespace path, which may be nested. */
    owner: 255,
    /** Maximum length of a project path. */
    name: 255,
    /** Maximum length of the full project path. */
    path: 255,
    /** Maximum length of a label name. */
    label: 255,
    /** Maximum length of a username. */
    login: 255,
  },
} as const;

/** A provider SnapTriage can talk to. */
export type ProviderName = keyof typeof providerLimits;

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

  /** Check the authenticated user's permission level on a repo.
   * Returns `null` when the token cannot see the repository at all. */
  getRepoPermission(owner: string, repo: string, token: string): Promise<RepoPermission | null>;

  /** Fetch all labels for a repo */
  fetchLabels?(owner: string, repo: string, token: string): Promise<ProviderLabel[]>;

  /** Fetch collaborators for a repo */
  fetchCollaborators?(owner: string, repo: string, token: string): Promise<ProviderCollaborator[]>;
}
