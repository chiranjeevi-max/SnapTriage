/**
 * @module db/schema.pg
 *
 * Postgres copy of `schema.ts`, read only by drizzle-kit to generate the
 * migrations in `drizzle-pg/` that `npm run db:migrate` applies when
 * `DATABASE_URL` is set.
 *
 * The app queries Postgres through the SQLite tables in `schema.ts`, so each
 * column here stores what its SQLite counterpart writes: epoch milliseconds as
 * `bigint`, booleans as `boolean`, JSON as text. Runtime defaults (`$defaultFn`)
 * and column types (`$type`) live in `schema.ts` alone. Table docs are there too;
 * `tests/unit/lib/db/schema-parity.test.ts` fails when the two drift apart.
 */
import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Epoch milliseconds, as a SQLite `timestamp_ms` column stores them. */
const epochMs = (name: string) => bigint(name, { mode: "number" });

// ─── Auth.js tables ───────────────────────────────────────

export const users = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: epochMs("emailVerified"),
  image: text("image"),
});

export const accounts = pgTable(
  "account",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
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

export const sessions = pgTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: epochMs("expires").notNull(),
});

export const verificationTokens = pgTable(
  "verificationToken",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: epochMs("expires").notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })]
);

// ─── App tables ───────────────────────────────────────────

export const accessTokens = pgTable(
  "access_token",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId"),
    token: text("token").notNull(),
    label: text("label"),
    createdAt: epochMs("createdAt").notNull(),
  },
  (table) => [
    uniqueIndex("access_token_user_provider_unique").on(table.userId, table.provider),
    uniqueIndex("access_token_provider_account_unique").on(table.provider, table.providerAccountId),
  ]
);

export const savedViews = pgTable(
  "saved_view",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    filter: text("filter").notNull().default("all"),
    createdAt: epochMs("createdAt").notNull(),
    updatedAt: epochMs("updatedAt").notNull(),
  },
  (table) => [index("saved_view_userId_idx").on(table.userId)]
);

export const rateLimitBuckets = pgTable(
  "rate_limit_bucket",
  {
    key: text("key").primaryKey(),
    count: integer("count").notNull().default(1),
    windowStart: epochMs("windowStart").notNull(),
  },
  (table) => [index("rate_limit_bucket_windowStart_idx").on(table.windowStart)]
);

export const webhookDeliveries = pgTable(
  "webhook_delivery",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id").notNull().unique(),
    provider: text("provider").notNull(),
    receivedAt: epochMs("receivedAt").notNull(),
  },
  (table) => [index("webhook_delivery_receivedAt_idx").on(table.receivedAt)]
);

export const repos = pgTable(
  "repo",
  {
    id: text("id").primaryKey(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("fullName").notNull(),
    permission: text("permission").notNull().default("read"),
    syncEnabled: boolean("syncEnabled").notNull().default(true),
    syncMode: text("syncMode").notNull().default("live"),
    lastSyncedAt: epochMs("lastSyncedAt"),
    createdAt: epochMs("createdAt").notNull(),
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

export const issues = pgTable(
  "issue",
  {
    id: text("id").primaryKey(),
    repoId: text("repoId")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    number: integer("number").notNull(),
    title: text("title").notNull(),
    body: text("body"),
    author: text("author"),
    authorAvatar: text("authorAvatar"),
    state: text("state").notNull().default("open"),
    labels: text("labels").notNull().default("[]"),
    assignees: text("assignees").notNull().default("[]"),
    url: text("url").notNull(),
    providerIssueId: text("providerIssueId").notNull(),
    createdAt: epochMs("createdAt").notNull(),
    updatedAt: epochMs("updatedAt").notNull(),
    fetchedAt: epochMs("fetchedAt").notNull(),
  },
  (table) => [
    index("issue_repoId_idx").on(table.repoId),
    index("issue_state_idx").on(table.state),
    index("issue_provider_issueId_idx").on(table.provider, table.providerIssueId),
    uniqueIndex("issue_repo_provider_issue_unique").on(table.repoId, table.providerIssueId),
  ]
);

export const triageState = pgTable(
  "triage_state",
  {
    id: text("id").primaryKey(),
    issueId: text("issueId")
      .notNull()
      .references(() => issues.id, { onDelete: "cascade" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    priority: integer("priority"),
    snoozedUntil: epochMs("snoozedUntil"),
    dismissed: boolean("dismissed").notNull().default(false),
    batchPending: boolean("batchPending").notNull().default(false),
    pendingChanges: text("pendingChanges").default("{}"),
    updatedAt: epochMs("updatedAt").notNull(),
  },
  (table) => [
    index("triage_issueId_userId_idx").on(table.issueId, table.userId),
    index("triage_userId_idx").on(table.userId),
    uniqueIndex("triage_issue_user_unique").on(table.issueId, table.userId),
  ]
);

export const syncLog = pgTable(
  "sync_log",
  {
    id: text("id").primaryKey(),
    repoId: text("repoId")
      .notNull()
      .references(() => repos.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    issuesFetched: integer("issuesFetched").default(0),
    error: text("error"),
    startedAt: epochMs("startedAt").notNull(),
    completedAt: epochMs("completedAt"),
  },
  (table) => [index("syncLog_repoId_idx").on(table.repoId)]
);
