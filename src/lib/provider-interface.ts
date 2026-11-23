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

/**
 * One comment on an issue.
 *
 * `isSystem` marks records the provider generated itself (a label change, a
 * close, a reference) rather than text a person wrote. Those matter to the
 * follow-up check: an automated "added label bug" is not a reply from anybody.
 */
export interface ProviderComment {
  /** The provider's stable comment id, kept as a string because the two providers disagree on width. */
  id: string;
  body: string;
  author: string | null;
  authorAvatar: string | null;
  createdAt: Date;
  updatedAt: Date;
  isSystem: boolean;
  /** Permalink to the comment, when the provider exposes one. */
  url: string | null;
}

/**
 * One page of comments, oldest first.
 *
 * Providers page in opposite directions (GitHub ascending only, GitLab
 * configurable), so the adapter normalises both to "oldest first within the
 * page, with a cursor that walks towards older history". Returning the cursor
 * instead of a page number keeps the caller from having to know which provider
 * it is talking to.
 */
export interface CommentPage {
  comments: ProviderComment[];
  /** Cursor for the next older page, or `null` when this is the oldest. */
  olderCursor: string | null;
}

/** Options for {@link IssueProvider.fetchComments}. */
export interface FetchCommentsOptions {
  /** Cursor returned by a previous call; omit for the newest page. */
  cursor?: string | null;
  /** Only return comments updated at or after this instant. */
  since?: Date;
  /** Page size, capped by the adapter at the provider's own maximum. */
  limit?: number;
}

/** A label on a repo */
export interface ProviderLabel {
  name: string;
  color: string | null; // hex without #
  description: string | null;
}

/**
 * Pages a label or collaborator listing may read.
 *
 * These listings are read on a keystroke to open a picker, so a repository with
 * pathologically many entries must not turn one keypress into an unbounded number
 * of provider calls. 20 pages is 2,000 entries, well past any real repository.
 */
export const LISTING_PAGE_LIMIT = 20;

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
    /**
     * Maximum length of a comment body, in characters.
     *
     * GitHub stores issue comments in a MySQL `mediumblob` (262,144 bytes), and
     * the API rejects a body over 65,536 characters. Confirmed by GitHub staff
     * in community discussion 27190 and by the rejection message users report
     * ("Comment is too long (maximum is 65536 characters)").
     */
    comment: 65_536,
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
    /**
     * Maximum length of a note body, in characters. Documented as
     * "Limited to 1,000,000 characters" on the Notes API reference.
     */
    comment: 1_000_000,
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

  /**
   * Fetch one page of an issue's discussion, oldest first.
   *
   * Optional because a provider may not expose comments; callers must treat a
   * missing implementation as "discussion unavailable" rather than as an empty
   * thread, so the UI can say so instead of implying nobody has replied.
   */
  fetchComments?(
    owner: string,
    repo: string,
    issueNumber: number,
    token: string,
    options?: FetchCommentsOptions
  ): Promise<CommentPage>;

  /**
   * Post a comment and return it as the provider stored it.
   *
   * There is no idempotency key on either provider's comment endpoint, so this
   * is not safe to retry blindly: a request that timed out may have created the
   * comment. Callers must not retry automatically and must reconcile before
   * offering a second send.
   */
  createComment?(
    owner: string,
    repo: string,
    issueNumber: number,
    token: string,
    body: string
  ): Promise<ProviderComment>;

  /**
   * Resolve the authenticated user's own login on this provider.
   *
   * Needed to tell "the reporter replied" from "I replied". Fetched per
   * provider rather than per repository, and cached by the caller.
   */
  getAuthenticatedUser?(token: string): Promise<{ login: string; avatar: string | null } | null>;
}
