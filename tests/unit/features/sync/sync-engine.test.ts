/* @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

/** An issue as GitHub's `GET /repos/{owner}/{repo}/issues` returns it. */
function githubIssue(number: number) {
  return {
    id: 1_000_000 + number,
    number,
    title: `Issue ${number}`,
    body: null,
    user: { login: "alice", avatar_url: "https://avatars.githubusercontent.com/u/1" },
    state: "open",
    labels: [],
    assignees: [],
    html_url: `https://github.com/octocat/large/issues/${number}`,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-02T00:00:00.000Z",
  };
}

describe("sync engine", () => {
  const dbPath = join(tmpdir(), `snaptriage-sync-${Date.now()}.db`);
  const dbDir = join(tmpdir(), "snaptriage-sync");

  beforeAll(async () => {
    mkdirSync(dbDir, { recursive: true });
    process.env.SQLITE_PATH = dbPath;
    process.env.AUTH_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const { db } = await import("@/lib/db");
    migrate(db as never, { migrationsFolder: join(process.cwd(), "drizzle") });

    const { typedDb } = await import("@/lib/db/query");
    const { users, repos, accessTokens } = await import("@/lib/db/schema");
    const { encrypt } = await import("@/lib/crypto");
    const sqlite = new Database(dbPath);
    sqlite.close();

    await typedDb.insert(users).values({
      id: "sync-user",
      name: "Sync Test",
      email: "sync@example.com",
      image: null,
    });

    await typedDb.insert(repos).values({
      id: "sync-repo-a",
      userId: "sync-user",
      provider: "github",
      owner: "octocat",
      name: "repo-a",
      fullName: "octocat/repo-a",
      permission: "write",
      syncEnabled: true,
      syncMode: "live",
    });
    await typedDb.insert(repos).values({
      id: "sync-repo-b",
      userId: "sync-user",
      provider: "github",
      owner: "octocat",
      name: "repo-b",
      fullName: "octocat/repo-b",
      permission: "write",
      syncEnabled: true,
      syncMode: "live",
    });

    await typedDb.insert(accessTokens).values({
      id: "sync-token",
      userId: "sync-user",
      provider: "github",
      token: encrypt("github-token"),
      label: "github-pat",
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 999,
          number: 1,
          title: "Synced issue",
          body: "body",
          user: { login: "alice", avatar_url: "https://example.com/avatar.png" },
          state: "open",
          labels: [{ name: "bug" }],
          assignees: [{ login: "alice" }],
          html_url: "https://github.com/octocat/repo-a/issues/1",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
  }, 30000);

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        unlinkSync(file);
      } catch {
        // cleanup best effort
      }
    }
  });

  it("idempotently upserts issues across repeated syncs", async () => {
    const { syncRepo } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");
    const { issues } = await import("@/lib/db/schema");

    await syncRepo("sync-repo-a", "sync-user");
    await syncRepo("sync-repo-a", "sync-user");

    const rows = await typedDb.select().from(issues).where(eq(issues.repoId, "sync-repo-a"));
    expect(rows).toHaveLength(1);
  }, 30000);

  it("refreshes a stored issue from a later sync", async () => {
    const { syncRepo } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");
    const { issues } = await import("@/lib/db/schema");
    await syncRepo("sync-repo-a", "sync-user");
    const [stored] = await typedDb
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.repoId, "sync-repo-a"));
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json([
        {
          id: 999,
          number: 1,
          title: "Renamed issue",
          body: "new body",
          user: { login: "bob", avatar_url: "https://example.com/bob.png" },
          state: "closed",
          labels: [{ name: "p1" }],
          assignees: [],
          html_url: "https://github.com/octocat/repo-a/issues/1",
          created_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-03T00:00:00.000Z",
        },
      ])
    );

    await syncRepo("sync-repo-a", "sync-user");

    const rows = await typedDb.select().from(issues).where(eq(issues.repoId, "sync-repo-a"));
    expect(rows).toEqual([
      expect.objectContaining({
        id: stored?.id,
        title: "Renamed issue",
        body: "new body",
        author: "bob",
        authorAvatar: "https://example.com/bob.png",
        state: "closed",
        labels: ["p1"],
        assignees: [],
        updatedAt: new Date("2026-01-03T00:00:00.000Z"),
      }),
    ]);
  }, 30000);

  it("syncs multiple repos concurrently", async () => {
    const { syncAllRepos } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");
    const { issues } = await import("@/lib/db/schema");

    await syncAllRepos("sync-user");
    const rows = await typedDb.select().from(issues);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  }, 30000);

  it("syncs a repository with more issues than one SQLite statement can bind", async () => {
    const { syncRepo } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");
    const { issues, repos } = await import("@/lib/db/schema");

    await typedDb.insert(repos).values({
      id: "sync-repo-large",
      userId: "sync-user",
      provider: "github",
      owner: "octocat",
      name: "large",
      fullName: "octocat/large",
      permission: "write",
    });
    // 30 full pages. As a single INSERT, 3,000 rows bind 48,000 parameters, far
    // past SQLite's limit of 32,766 even if the table loses a few columns.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const page = Number(new URL(url).searchParams.get("page"));
        const first = (page - 1) * 100 + 1;
        const count = Math.max(0, Math.min(100, 3000 - first + 1));
        return Response.json(Array.from({ length: count }, (_, i) => githubIssue(first + i)));
      })
    );

    const result = await syncRepo("sync-repo-large", "sync-user");

    expect(result).toMatchObject({ status: "completed", issuesFetched: 3000 });
    const rows = await typedDb
      .select({ id: issues.id })
      .from(issues)
      .where(eq(issues.repoId, "sync-repo-large"));
    expect(rows).toHaveLength(3000);
  }, 30000);

  it("reports staged changes as pushed once the provider accepts them", async () => {
    const { pushBatchChanges } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");
    const { issues, triageState } = await import("@/lib/db/schema");

    await typedDb.insert(issues).values({
      id: "staged-issue",
      repoId: "sync-repo-a",
      provider: "github",
      number: 7,
      title: "Staged",
      labels: ["bug"],
      url: "https://github.com/octocat/repo-a/issues/7",
      providerIssueId: "staged-7",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await typedDb.insert(triageState).values({
      id: "staged-triage",
      issueId: "staged-issue",
      userId: "sync-user",
      batchPending: true,
      pendingChanges: { labels: { add: ["triaged"], remove: [] } },
    });
    const github = vi.fn(async () => Response.json([{ name: "bug" }, { name: "triaged" }]));
    vi.stubGlobal("fetch", github);

    expect(await pushBatchChanges("sync-user")).toEqual({ pushed: 1, failed: 0 });

    expect(github).toHaveBeenCalledWith(
      "https://api.github.com/repos/octocat/repo-a/issues/7/labels",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ labels: ["triaged"] }) })
    );

    const [triage] = await typedDb
      .select()
      .from(triageState)
      .where(eq(triageState.id, "staged-triage"));
    expect(triage).toMatchObject({ batchPending: false, pendingChanges: {} });
    const [issue] = await typedDb.select().from(issues).where(eq(issues.id, "staged-issue"));
    expect(issue.labels).toEqual(["bug", "triaged"]);
  }, 30000);
});
