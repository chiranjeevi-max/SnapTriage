/* @vitest-environment node */
/**
 * @module tests/unit/features/sync/batch-race.test.ts
 *
 * A batch push reads the staged diffs, spends a network round trip on the
 * provider, and then clears them. Anything the user stages during that window is
 * work the push never sent — so clearing unconditionally destroyed it: the values
 * were gone and the flag was down, leaving nothing to retry.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, eq, sql } from "drizzle-orm";

describe("a staging write during a batch push", () => {
  const dbPath = join(tmpdir(), `snaptriage-batch-race-${Date.now()}.db`);

  beforeAll(async () => {
    process.env.SQLITE_PATH = dbPath;
    process.env.AUTH_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const { db } = await import("@/lib/db");
    migrate(db as never, { migrationsFolder: join(process.cwd(), "drizzle") });

    const { typedDb } = await import("@/lib/db/query");
    const { users, repos, issues, accessTokens } = await import("@/lib/db/schema");
    const { encrypt } = await import("@/lib/crypto");

    await typedDb.insert(users).values({ id: "race-user", name: "Race" });
    await typedDb.insert(repos).values({
      id: "race-repo",
      userId: "race-user",
      provider: "github",
      owner: "acme",
      name: "widgets",
      fullName: "acme/widgets",
      permission: "write",
      syncMode: "batch",
    });
    await typedDb.insert(issues).values({
      id: "race-issue",
      repoId: "race-repo",
      provider: "github",
      number: 7,
      title: "Racy",
      labels: [],
      url: "https://example.test/7",
      providerIssueId: "gh-7",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await typedDb.insert(accessTokens).values({
      id: "race-token",
      userId: "race-user",
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
    vi.unstubAllGlobals();
  });

  /**
   * @target pushBatchChanges
   * @dependencies clearBatchPendingQuery
   * @scenario The user stages another label while the provider call is in flight
   * @expectedOutput The newly staged value survives with `batchPending` still
   *                 set, so the next push sends it. Clearing unconditionally
   *                 wiped it to `{}` and dropped the flag, and the label was
   *                 never sent and never retried.
   */
  it("keeps a change staged while the provider call is in flight", async () => {
    const { typedDb } = await import("@/lib/db/query");
    const { triageState } = await import("@/lib/db/schema");
    const { pushBatchChanges } = await import("@/features/sync/sync-engine");

    await typedDb.insert(triageState).values({
      id: "race-triage",
      issueId: "race-issue",
      userId: "race-user",
      batchPending: true,
      pendingChanges: { labels: { add: ["bug"], remove: [] } },
    });

    let stageDuringPush: Promise<void> = Promise.resolve();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        // Stands in for the user pressing `l` and picking another label while
        // the request is outstanding. It is the same merge the service performs:
        // a read-modify-write that bumps the revision.
        stageDuringPush = (async () => {
          await typedDb
            .update(triageState)
            .set({
              pendingChanges: { labels: { add: ["bug", "urgent"], remove: [] } },
              revision: sql`${triageState.revision} + 1`,
              batchPending: true,
              updatedAt: new Date(),
            })
            .where(eq(triageState.id, "race-triage"));
        })();
        await stageDuringPush;
        return Response.json([{ name: "bug" }]);
      })
    );

    expect(await pushBatchChanges("race-user")).toEqual({ pushed: 1, failed: 0 });

    const [stored] = await typedDb
      .select()
      .from(triageState)
      .where(eq(triageState.id, "race-triage"));

    // The push sent `bug`; `urgent` was staged after that snapshot and is still
    // waiting.
    expect(stored.pendingChanges).toEqual({ labels: { add: ["bug", "urgent"], remove: [] } });
    expect(stored.batchPending).toBe(true);
  }, 30000);

  /**
   * @target pushBatchChanges
   * @dependencies clearBatchPendingQuery
   * @scenario Nothing else is staged while the push runs
   * @expectedOutput The row is cleared as before, so the guard does not block
   *                 the normal path.
   */
  it("clears when nothing changed during the push", async () => {
    const { typedDb } = await import("@/lib/db/query");
    const { triageState } = await import("@/lib/db/schema");
    const { pushBatchChanges } = await import("@/features/sync/sync-engine");

    await typedDb
      .update(triageState)
      .set({
        batchPending: true,
        pendingChanges: { labels: { add: ["chore"], remove: [] } },
        revision: 0,
      })
      .where(and(eq(triageState.id, "race-triage"), eq(triageState.userId, "race-user")));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([{ name: "chore" }]))
    );

    expect(await pushBatchChanges("race-user")).toEqual({ pushed: 1, failed: 0 });

    const [stored] = await typedDb
      .select()
      .from(triageState)
      .where(eq(triageState.id, "race-triage"));

    expect(stored.pendingChanges).toEqual({});
    expect(stored.batchPending).toBe(false);
    expect(stored.revision).toBe(1);
  }, 30000);
});
