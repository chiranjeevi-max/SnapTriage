/* @vitest-environment node */
/**
 * @module tests/unit/features/sync/watermark.test.ts
 *
 * The sync watermark decides what the *next* sync asks for, and both providers
 * filter `since` / `updated_after` strictly. Stamping it after the fetch means
 * anything updated while the pages were still arriving is stepped over on the
 * next pass — the change is lost, not delayed. These fix the watermark to the
 * instant the read began.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { eq } from "drizzle-orm";

describe("sync watermark", () => {
  const dbPath = join(tmpdir(), `snaptriage-watermark-${Date.now()}.db`);

  beforeAll(async () => {
    mkdirSync(join(tmpdir(), "snaptriage-watermark"), { recursive: true });
    process.env.SQLITE_PATH = dbPath;
    process.env.AUTH_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const { db } = await import("@/lib/db");
    migrate(db as never, { migrationsFolder: join(process.cwd(), "drizzle") });

    const { typedDb } = await import("@/lib/db/query");
    const { users, repos, accessTokens } = await import("@/lib/db/schema");
    const { encrypt } = await import("@/lib/crypto");

    await typedDb.insert(users).values({ id: "wm-user", name: "Watermark" });
    await typedDb.insert(repos).values({
      id: "wm-repo",
      userId: "wm-user",
      provider: "github",
      owner: "octocat",
      name: "watermark",
      fullName: "octocat/watermark",
      permission: "write",
    });
    await typedDb.insert(accessTokens).values({
      id: "wm-token",
      userId: "wm-user",
      provider: "github",
      token: encrypt("github-token"),
    });
  }, 30000);

  afterAll(() => {
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        unlinkSync(file);
      } catch {
        // cleanup best effort
      }
    }
  });

  /**
   * @target syncRepo's lastSyncedAt write
   * @dependencies SQLite, mocked fetch
   * @scenario The provider takes measurable time to answer, so the read starts
   *           well before the sync finishes
   * @expectedOutput The stored watermark is stamped at or before the read's
   *                 start. A finish-time stamp would step over an issue updated
   *                 in between on the next pass.
   */
  it("stamps the watermark at the start of the read, not its end", async () => {
    const { syncRepo } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");
    const { repos } = await import("@/lib/db/schema");

    let releaseFetch: (() => void) | undefined;
    let fetchStartedAt = 0;
    const fetchStarted = new Promise<void>((resolveStarted) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          fetchStartedAt = Date.now();
          resolveStarted();
          await new Promise<void>((release) => {
            releaseFetch = release;
          });
          return Response.json([]);
        })
      );
    });

    const sync = syncRepo("wm-repo", "wm-user");
    await fetchStarted;
    // The provider "takes" a while, as it does across many pages.
    await new Promise((resolve) => setTimeout(resolve, 60));
    releaseFetch?.();
    expect(await sync).toMatchObject({ status: "completed" });

    const [repo] = await typedDb.select().from(repos).where(eq(repos.id, "wm-repo"));
    expect(repo.lastSyncedAt).not.toBeNull();
    expect(repo.lastSyncedAt!.getTime()).toBeLessThanOrEqual(fetchStartedAt);

    vi.unstubAllGlobals();
  }, 30000);

  /**
   * @target the stored watermark's relationship to the read it describes
   * @dependencies SQLite, mocked fetch that honours `since` strictly
   * @scenario An issue is updated after the provider answered but before the
   *           sync finished writing — the window the bug lived in
   * @expectedOutput The next sync still fetches it. With a finish-time stamp
   *                 the next `since` is later than that update and the provider's
   *                 strict filter skips it permanently.
   */
  it("keeps an issue updated during the sync inside the next window", async () => {
    const { syncRepo } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");
    const { issues, repos } = await import("@/lib/db/schema");

    await typedDb.delete(issues).where(eq(issues.repoId, "wm-repo"));
    await typedDb.update(repos).set({ lastSyncedAt: null }).where(eq(repos.id, "wm-repo"));

    // Stands in for an issue that only starts to exist upstream partway
    // through the first sync.
    let landedAt: number | null = null;
    const urls: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        const since = new URL(url).searchParams.get("since");
        if (since === null) {
          // First sync: empty, and the update lands as the read returns.
          landedAt = Date.now();
          return Response.json([]);
        }
        const updatedAt = new Date(landedAt!).toISOString();
        if (new Date(since).getTime() >= landedAt!) return Response.json([]);
        return Response.json([
          {
            id: 4242,
            number: 42,
            title: "Landed mid-sync",
            body: null,
            user: { login: "alice", avatar_url: null },
            state: "open",
            labels: [],
            assignees: [],
            html_url: "https://github.com/octocat/watermark/issues/42",
            created_at: updatedAt,
            updated_at: updatedAt,
          },
        ]);
      })
    );

    await syncRepo("wm-repo", "wm-user");
    await syncRepo("wm-repo", "wm-user");

    const rows = await typedDb.select().from(issues).where(eq(issues.repoId, "wm-repo"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Landed mid-sync", number: 42 });
    // The second request carried a window that reached back past the update.
    expect(new URL(urls[1]).searchParams.get("since")).not.toBeNull();

    vi.unstubAllGlobals();
  }, 30000);
});
