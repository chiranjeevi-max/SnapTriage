/* @vitest-environment node */
/**
 * @module tests/unit/features/sync/failure-reporting.test.ts
 *
 * `syncRepo` promises a `SyncResult`, never a rejection. `POST /api/sync` calls
 * it directly for a single repo, so a rejection there becomes a bare 500 with no
 * outcome at all — worst when the database is the component that failed, which is
 * exactly when the failure record has to be written by the same database.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

describe("syncRepo failure reporting", () => {
  const dbPath = join(tmpdir(), `snaptriage-sync-fail-${Date.now()}.db`);

  beforeAll(async () => {
    process.env.SQLITE_PATH = dbPath;
    process.env.AUTH_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const { db } = await import("@/lib/db");
    migrate(db as never, { migrationsFolder: join(process.cwd(), "drizzle") });

    const { typedDb } = await import("@/lib/db/query");
    const { users, repos } = await import("@/lib/db/schema");

    await typedDb.insert(users).values({ id: "fail-user", name: "Fail" });
    await typedDb.insert(repos).values({
      id: "fail-repo",
      userId: "fail-user",
      provider: "github",
      owner: "acme",
      name: "widgets",
      fullName: "acme/widgets",
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
   * @target syncRepo
   * @dependencies syncLog, typedDb
   * @scenario The sync log cannot be written because the database is failing
   * @expectedOutput A failed `SyncResult`, not a rejected promise. Before the
   *                 change the `started` insert sat outside the try and threw
   *                 straight out of the route.
   */
  it("returns a failed result when the log write fails", async () => {
    const { syncRepo } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");

    const insert = vi.spyOn(typedDb, "insert").mockImplementationOnce(() => {
      throw new Error("database is locked");
    });

    const result = await syncRepo("fail-repo", "fail-user");

    expect(result).toMatchObject({ status: "failed", error: "database is locked" });
    insert.mockRestore();
  }, 30000);

  /**
   * @target syncRepo
   * @dependencies typedDb.select
   * @scenario The database fails on the very first read, the repository lookup
   * @expectedOutput A failed `SyncResult`, not a rejected promise. The lookup sat
   *                 outside the guard, so this was the case the route could not
   *                 report at all.
   */
  it("returns a failed result when the repository lookup fails", async () => {
    const { syncRepo } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");

    const select = vi.spyOn(typedDb, "select").mockImplementationOnce(() => {
      throw new Error("database is locked");
    });

    const result = await syncRepo("fail-repo", "fail-user");

    expect(result).toMatchObject({ status: "failed", error: "database is locked" });
    select.mockRestore();
  }, 30000);

  /**
   * @target syncRepo
   * @dependencies getProviderToken
   * @scenario The sync fails for an ordinary reason (no token)
   * @expectedOutput A failed result whose failure is recorded in `sync_log`, so
   *                 the guard above does not skip normal reporting.
   */
  it("records an ordinary failure in the log", async () => {
    const { syncRepo } = await import("@/features/sync/sync-engine");
    const { typedDb } = await import("@/lib/db/query");
    const { syncLog } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");

    const result = await syncRepo("fail-repo", "fail-user");

    expect(result).toMatchObject({ status: "failed" });
    const rows = await typedDb.select().from(syncLog).where(eq(syncLog.repoId, "fail-repo"));
    expect(rows.some((row) => row.status === "failed")).toBe(true);
  }, 30000);
});
