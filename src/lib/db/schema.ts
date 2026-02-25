import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";
import type { AdapterAccountType } from "@auth/core/adapters";

// ─── Auth.js tables ───────────────────────────────────────

export const users = sqliteTable("user", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: integer("emailVerified", { mode: "timestamp_ms" }),
  image: text("image"),
});

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

export const sessions = sqliteTable("session", {
  sessionToken: text("sessionToken").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: integer("expires", { mode: "timestamp_ms" }).notNull(),
});

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

export const accessTokens = sqliteTable("access_token", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // "github" | "gitlab"
  token: text("token").notNull(),
  label: text("label"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
});

// ─── Repos ────────────────────────────────────────────────

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
  ]
);

// ─── Issues ───────────────────────────────────────────────

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
  ]
);

// ─── Triage State ─────────────────────────────────────────

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
  ]
);

// ─── Sync Log ─────────────────────────────────────────────

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
