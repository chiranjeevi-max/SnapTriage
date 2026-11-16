/**
 * @module db/schema
 *
 * Drizzle ORM schema definitions for the SnapTriage SQLite database.
 *
 * Tables are organized into three groups:
 * 1. **Auth.js tables**: `users`, `accounts`, `sessions`, `verificationTokens`
 *    (required by NextAuth / Auth.js adapter)
 * 2. **Application tables**: `accessTokens`, `repos`, `issues`
 *    (PAT storage, tracked repositories, cached issue data)
 * 3. **Triage tables**: `triageState`, `syncLog`
 *    (per-user triage decisions and sync audit trail)
 */
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "@auth/core/adapters";

// ─── Auth.js tables ───────────────────────────────────────

/**
 * Core user table managed by Auth.js.
 * Each OAuth login or PAT sign-in creates a row here.
 */
export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
});

/**
 * OAuth account link table managed by Auth.js.
 * Stores provider tokens (access_token, refresh_token) for each linked account.
 * Composite primary key: (provider, providerAccountId).
 */
export const accounts = sqliteTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })]
);

/** Active session table managed by Auth.js (database strategy). */
export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

/** Email verification tokens managed by Auth.js. */
export const verificationTokens = sqliteTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// ─── Custom: Access Tokens ────────────────────────────────

/**
 * Personal Access Tokens (PATs) stored by users as an alternative to OAuth.
 * Each token is scoped to a single provider ("github" | "gitlab") and records
 * the provider account it belongs to, which is how PAT sign-in finds its user.
 */
export const accessTokens = sqliteTable(
  "access_token",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "github" | "gitlab"
    // The account that owns the token, as `<instance>/<id>` (`github.com/123`),
    // since ids repeat across GitLab instances. Null only on rows stored before
    // it was recorded.
    providerAccountId: text("providerAccountId"),
    token: text("token").notNull(),
    label: text("label"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("access_token_user_provider_unique").on(table.userId, table.provider),
    uniqueIndex("access_token_provider_account_unique").on(table.provider, table.providerAccountId),
  ]
);

// ─── Saved Inbox Views ────────────────────────────────────

/**
 * User-defined inbox views (filter/priority/state combinations).
 * Stored per user so preferences survive device and browser changes.
 */
export const savedViews = sqliteTable(
  "saved_view",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filter: text("filter").notNull().default("all"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("saved_view_userId_idx").on(table.userId)]
);

// ─── Rate Limit Buckets ────────────────────────────────────

/**
 * Shared request counters used by endpoints that must limit across
 * database-backed instances (e.g. PAT authentication).
 */
export const rateLimitBuckets = sqliteTable(
  "rate_limit_bucket",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(1),
    windowStart: integer("windowStart", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("rate_limit_bucket_windowStart_idx").on(table.windowStart)]
);

// ─── Webhook Deliveries ──────────────────────────────────────

/**
 * Seen webhook delivery IDs used for replay protection.
 *
 * GitHub sends `X-GitHub-Delivery`; GitLab sends `X-Gitlab-Event-UUID`.
 * Recording each delivery ID (provider-scoped) and rejecting repeats makes the
 * webhook endpoint idempotent: a captured or re-sent delivery cannot trigger
 * the same sync twice. Rows are purged as deliveries come in, so the table
 * cannot grow without bound.
 */
export const webhookDeliveries = sqliteTable(
  "webhook_delivery",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // `${provider}:${deliveryId}` is provider-scoped so GitHub and GitLab IDs
    // cannot collide with each other.
    deliveryId: text("delivery_id").notNull().unique(),
    provider: text("provider").notNull(),
    receivedAt: integer("receivedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("webhook_delivery_receivedAt_idx").on(table.receivedAt)]
);

// ─── Repos ────────────────────────────────────────────────

/**
 * Tracked repositories that a user has opted-in for triage.
 * `syncMode` controls whether changes are written back immediately ("live")
 * or staged for manual push ("batch").
 */
export const repos = sqliteTable(
  "repo",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "github" | "gitlab"
    owner: text("owner").notNull(), // org or user
    name: text("name").notNull(), // repo name
    fullName: text("fullName").notNull(), // "owner/name"
    permission: text("permission").notNull().default("read"), // "admin" | "write" | "read"
    syncEnabled: integer("syncEnabled", { mode: "boolean" }).notNull().default(true),
    syncMode: text("syncMode").notNull().default("live"), // "live" | "batch"
    lastSyncedAt: integer("lastSyncedAt", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("repo_userId_idx").on(table.userId),
    index("repo_provider_fullName_idx").on(table.provider, table.fullName),
    uniqueIndex("repo_user_provider_fullName_unique").on(
      table.userId,
      table.provider,
      table.fullName
    ),
  ]
);

// ─── Issues ───────────────────────────────────────────────

/**
 * Cached issues fetched from GitHub/GitLab during sync.
 * `providerIssueId` is the provider's unique ID, separate from SnapTriage's own `id`.
 * Indices cover common query patterns: by repo, by state, and by provider+issueId.
 */
export const issues = sqliteTable(
  "issue",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repoId: text("repoId")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "github" | "gitlab"
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    author: text("author"), // username
    authorAvatar: text("authorAvatar"),
    state: text("state").notNull().default("open"), // "open" | "closed"
    labels: text("labels", { mode: "json" }).$type<string[]>().notNull().default([]),
    assignees: text("assignees", { mode: "json" }).$type<string[]>().notNull().default([]),
    url: text("url").notNull(), // link to issue on provider
    providerIssueId: text("providerIssueId").notNull(), // provider's unique ID
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" }).notNull(),
    fetchedAt: integer("fetchedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("issue_repoId_idx").on(table.repoId),
    index("issue_state_idx").on(table.state),
    index("issue_provider_issueId_idx").on(table.provider, table.providerIssueId),
    uniqueIndex("issue_repo_provider_issue_unique").on(table.repoId, table.providerIssueId),
  ]
);

// ─── Triage State ─────────────────────────────────────────

/**
 * Per-user triage decisions for each issue.
 * Stores priority, snooze, dismiss state, and pending batch changes.
 * `pendingChanges` is a JSON blob holding label/assignee/state diffs
 * that haven't been pushed to the provider yet (batch mode).
 */
export const triageState = sqliteTable(
  "triage_state",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    issueId: text("issueId")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    priority: integer("priority"), // 0-3 (P0 = critical, P3 = low), null = unset
    snoozedUntil: integer("snoozedUntil", { mode: "timestamp_ms" }),
    dismissed: integer("dismissed", { mode: "boolean" }).notNull().default(false),
    batchPending: integer("batchPending", { mode: "boolean" }).notNull().default(false),
    /**
     * Bumped on every write, and used as the compare-and-set token for staging.
     *
     * Not `updatedAt`: two writers in the same millisecond read and write the
     * same value, so the second comparison passes and the loser's merge is
     * overwritten. A counter has no such tie.
     */
    revision: integer("revision").notNull().default(0),
    pendingChanges: text("pendingChanges", { mode: "json" })
      .$type<Record<string, unknown>>()
      .default({}),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("triage_issueId_userId_idx").on(table.issueId, table.userId),
    index("triage_userId_idx").on(table.userId),
    uniqueIndex("triage_issue_user_unique").on(table.issueId, table.userId),
  ]
);

// ─── Triage Presets ───────────────────────────────────────

/**
 * A user's named, repository-scoped bundle of triage actions.
 *
 * A preset is the decision, not the action: it stores what the user wants
 * (labels, assignees, personal priority) and the resolver turns that into the
 * diff for one issue at apply time. It is deliberately *not* a rule — nothing
 * applies a preset by itself, and a stored preset never widens its own scope.
 *
 * `actions` is validated on every write and again on every read, because a
 * provider can rename a label or an assignee can lose access between the
 * moment the preset was saved and the moment it is applied.
 *
 * Presets are personal: two users who connect the same upstream repository
 * have separate preset rows, keyed by their own `userId`.
 */
export const triagePresets = sqliteTable(
  "triage_preset",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoId: text("repoId")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * Stored as a {@link PresetActions} JSON object: `priority`, `labels`, and
     * `assignees` only. Snooze, dismiss, and state are excluded on purpose —
     * a preset must not close an issue or hide it from the queue.
     */
    actions: text("actions", { mode: "json" })
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("triage_preset_userId_repoId_idx").on(table.userId, table.repoId),
    index("triage_preset_repoId_idx").on(table.repoId),
  ]
);

// ─── Reply Drafts ─────────────────────────────────────────

/**
 * Per-issue, per-user reply draft.
 *
 * The draft lives on the server rather than in the browser because the text is
 * the user's work and has to survive a reload, a different tab, and a crash.
 * It is keyed by `(issueId, userId)` so there can never be two drafts for one
 * issue, and a `sendAttemptedAt` marker records that a send was started and its
 * outcome was not confirmed: a timed-out POST may have created the comment, so
 * the client must reconcile instead of retrying into a duplicate.
 *
 * The unique key doubles as the concurrency guard. Editing is a conditional
 * update on `version`, so two tabs autosaving the same draft cannot silently
 * overwrite each other; the loser re-reads.
 */
export const replyDrafts = sqliteTable(
  "reply_draft",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    issueId: text("issueId")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull().default(""),
    /** Incremented on every save; a stale writer is rejected rather than merged. */
    version: integer("version").notNull().default(1),
    /**
     * Set when a send is dispatched and not yet confirmed. Non-null means "do
     * not offer Send again until this is resolved"; it is cleared only by a
     * confirmed send or an explicit reconciliation.
     */
    sendAttemptedAt: integer("sendAttemptedAt", { mode: "timestamp_ms" }),
    /**
     * Identifies the attempt that took the claim.
     *
     * A tab that shows "unconfirmed" must release *that* attempt, not whatever
     * marker happens to be set when the request arrives: another tab can release
     * and re-claim in between, and releasing the newer claim would let two sends
     * overlap. Compared, never interpreted.
     */
    sendClaimId: text("sendClaimId"),
    /**
     * When the provider call is expected to have finished, or null when no call
     * is in flight.
     *
     * A lease rather than a boolean: a process that dies mid-call must not leave
     * the draft permanently unreleasable. Past this instant the call is assumed
     * to have ended however it ended, and the claim becomes a normal unresolved
     * one the user may reconcile.
     */
    sendInFlightUntil: integer("sendInFlightUntil", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("reply_draft_issue_user_unique").on(table.issueId, table.userId),
    index("reply_draft_userId_idx").on(table.userId),
  ]
);

// ─── Saved Replies ────────────────────────────────────────

/**
 * A reusable reply template, personal to one user.
 *
 * Kept separate from the draft because the lifetime differs: a template is
 * long-lived and reused, a draft is per issue and disposable. Scoped by
 * `userId` only — a template is prose, not a provider value, so it is not
 * repository-specific and can be offered anywhere the user can comment.
 */
export const savedReplies = sqliteTable(
  "saved_reply",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    body: text("body").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index("saved_reply_userId_idx").on(table.userId)]
);

// ─── Follow-up Tracking ───────────────────────────────────

/**
 * An issue the user has explicitly asked to be told about when something
 * external happens.
 *
 * The row *is* the baseline: `lastSeenCommentId` and `lastSeenCommentAt` record
 * what had already been read when the user chose to wait, and a follow-up is
 * raised when qualifying activity lands after both. Storing the comment id as
 * well as the timestamp is deliberate — timestamps tie (providers expose
 * second granularity in some payloads, and a burst of comments can share one),
 * and an id comparison is exact where a `>` on a timestamp is not.
 *
 * `state` is separate from `triage_state.snoozedUntil` on purpose: a snooze is
 * a timer, a follow-up is an event. An issue can be in either, both, or
 * neither, and the two must not clear each other.
 */
export const followUps = sqliteTable(
  "follow_up",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    issueId: text("issueId")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `waiting` is active; `reviewed` and `stopped` are terminal until re-armed. */
    state: text("state").notNull().default("waiting"), // "waiting" | "reviewed" | "stopped"
    /** Highest comment id that had been read when the baseline was taken. */
    lastSeenCommentId: text("lastSeenCommentId"),
    /** Newest comment instant at baseline time, used as the coarse filter. */
    lastSeenCommentAt: integer("lastSeenCommentAt", { mode: "timestamp_ms" }),
    /**
     * The issue's state when the user started waiting.
     *
     * A reopen is only observable as a *transition*. Waiting is normally armed
     * on an open issue, so "is open now" cannot mean "was reopened" — without
     * the prior state every waiting issue would resurface instantly. Storing it
     * makes the check honest: only a closed → open change is a reopen.
     */
    stateAtBaseline: text("stateAtBaseline").notNull().default("open"),
    /**
     * The issue state the last check actually observed.
     *
     * `stateAtBaseline` alone cannot see a reopen that happens between checks:
     * armed open, observed closed, observed open again reads as "open then open".
     * Comparing consecutive observations catches the transition, and it is
     * written only when a check completes so a failed read cannot move it.
     */
    lastObservedState: text("lastObservedState"),
    /** Comment id whose review dismissed the resurface, so it cannot raise again. */
    reviewedCommentId: text("reviewedCommentId"),
    /** Why the issue most recently came back, for the queue's one-line reason. */
    reason: text("reason"),
    /** When that reason was computed, so the UI can show its age honestly. */
    checkedAt: integer("checkedAt", { mode: "timestamp_ms" }),
    /**
     * When this row was last attempted, whether or not the attempt succeeded.
     *
     * Separate from `checkedAt`, which only moves on a completed check, so the
     * UI can keep showing the age of a successful result. Scheduling reads this
     * one: with only `checkedAt` to order by, a row whose provider read keeps
     * failing never advances and occupies the batch on every pass, starving the
     * rows behind it.
     */
    attemptedAt: integer("attemptedAt", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("follow_up_issue_user_unique").on(table.issueId, table.userId),
    index("follow_up_user_state_idx").on(table.userId, table.state),
    /**
     * Serves the check pass, which filters on `(userId, state)` and orders by
     * `(attemptedAt, checkedAt)` with a limit.
     *
     * Without it SQLite and Postgres both fall back to a temporary B-tree sort of
     * every waiting row for that user, which measured ~23x slower on 5,000 rows.
     * The columns continue the filter's own prefix, so one index serves both.
     */
    index("follow_up_due_idx").on(table.userId, table.state, table.attemptedAt, table.checkedAt),
  ]
);

/**
 * The login a user holds on a provider, remembered per provider.
 *
 * Without this the app cannot tell the user's own comment from a reporter's,
 * which is the whole discrimination problem behind follow-up: a resurface that
 * fires on your own reply is worse than no resurface at all.
 */
export const providerIdentities = sqliteTable(
  "provider_identity",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(), // "github" | "gitlab"
    login: text("login").notNull(),
    avatar: text("avatar"),
    fetchedAt: integer("fetchedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("provider_identity_user_provider_unique").on(table.userId, table.provider),
  ]
);

// ─── Sync Log ─────────────────────────────────────────────

/**
 * Audit trail for sync operations. Each row tracks a single repo sync attempt,
 * recording status ("started" | "completed" | "failed"), issue count, and timing.
 */
export const syncLog = sqliteTable(
  "sync_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    repoId: text("repoId")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    status: text("status").notNull(), // "started" | "completed" | "failed"
    issuesFetched: integer("issuesFetched").default(0),
    error: text("error"),
    startedAt: integer("startedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    completedAt: integer("completedAt", { mode: "timestamp_ms" }),
  },
  (table) => [index("syncLog_repoId_idx").on(table.repoId)]
);
