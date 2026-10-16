/* @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";

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
    migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });

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

  afterAll(() => {
    try {
      const fs = require("node:fs");
      fs.unlinkSync(dbPath);
      fs.unlinkSync(`${dbPath}-wal`);
      fs.unlinkSync(`${dbPath}-shm`);
    } catch {
      // cleanup best effort
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

  it("syncs multiple repos concurrently", async () => {
    const { syncAllRepos } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");
    const { issues } = await import("@/lib/db/schema");

    await syncAllRepos("sync-user");
    const rows = await typedDb.select().from(issues);
    expect(rows.length).toBeGreaterThanOrEqual(2);
  }, 30000);
});
