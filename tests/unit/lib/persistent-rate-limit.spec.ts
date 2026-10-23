import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { rateLimitBuckets } from "@/lib/db/schema";

describe("checkPersistentRateLimit", () => {
  const dbDir = join(tmpdir(), "snaptriage-tests");
  mkdirSync(dbDir, { recursive: true });
  const dbPath = join(dbDir, `persistent-rate-limit-${Date.now()}.db`);

  beforeAll(async () => {
    vi.resetModules();
    process.env.SQLITE_PATH = dbPath;
    delete process.env.DATABASE_URL;

    const { sql } = await import("drizzle-orm");
    const query = await import("@/lib/db/query");
    const typedDb = query.typedDb;

    await typedDb.run(
      sql`CREATE TABLE IF NOT EXISTS rate_limit_bucket (key TEXT PRIMARY KEY, count INTEGER NOT NULL, windowStart INTEGER NOT NULL)`
    );
  });

  afterAll(() => {
    try {
      unlinkSync(dbPath);
      unlinkSync(`${dbPath}-wal`);
      unlinkSync(`${dbPath}-shm`);
    } catch {
      // cleanup best effort
    }
  });

  it("allows requests under the configured limit", async () => {
    const { checkPersistentRateLimit } = await import("@/lib/rate-limit");
    const { sql } = await import("drizzle-orm");
    const query = await import("@/lib/db/query");
    const typedDb = query.typedDb;

    await typedDb.run(sql`DELETE FROM rate_limit_bucket`);
    expect(await checkPersistentRateLimit("under", 2, 1000)).toBe(false);
    expect(await checkPersistentRateLimit("under", 2, 1000)).toBe(false);
  });

  it("blocks the request that exceeds the configured limit", async () => {
    const { checkPersistentRateLimit } = await import("@/lib/rate-limit");
    const { sql } = await import("drizzle-orm");
    const query = await import("@/lib/db/query");
    const typedDb = query.typedDb;

    await typedDb.run(sql`DELETE FROM rate_limit_bucket`);
    checkPersistentRateLimit("over", 2, 1000);
    checkPersistentRateLimit("over", 2, 1000);
    expect(await checkPersistentRateLimit("over", 2, 1000)).toBe(true);
  });

  it("resets after the window elapses", async () => {
    const { checkPersistentRateLimit } = await import("@/lib/rate-limit");
    const { sql } = await import("drizzle-orm");
    const query = await import("@/lib/db/query");
    const typedDb = query.typedDb;

    await typedDb.run(sql`DELETE FROM rate_limit_bucket`);
    const tinyWindow = 1;
    await checkPersistentRateLimit("reset", 1, tinyWindow);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(await checkPersistentRateLimit("reset", 1, tinyWindow)).toBe(false);
  });

  describe("expired bucket purge", () => {
    /**
     * @target checkPersistentRateLimit
     * @dependencies SQLite driver, rate_limit_bucket table
     * @scenario A bucket whose window has long since elapsed is present
     * @expectedOutput Any subsequent check deletes it. The purge predicate must
     *                 bind a value the driver accepts and that compares correctly
     *                 against an integer-millis column; binding a Date here
     *                 throws in better-sqlite3 and silently disables the cleanup,
     *                 letting the table grow without bound.
     */
    it("deletes expired buckets on the default SQLite driver", async () => {
      const { checkPersistentRateLimit } = await import("@/lib/rate-limit");
      const { typedDb } = await import("@/lib/db/query");

      await typedDb.run(sql`DELETE FROM rate_limit_bucket`);
      await typedDb.insert(rateLimitBuckets).values({
        key: "pat:expired-host",
        count: 3,
        windowStart: new Date(Date.now() - 60 * 60 * 1000),
      });

      // A check for an unrelated key still runs the purge.
      await checkPersistentRateLimit("other-host", 5, 1000);

      const remaining = await typedDb
        .select()
        .from(rateLimitBuckets)
        .where(eq(rateLimitBuckets.key, "pat:expired-host"));

      expect(remaining).toHaveLength(0);
    });

    /**
     * @target checkPersistentRateLimit
     * @dependencies SQLite driver, rate_limit_bucket table
     * @scenario A bucket inside its window is present
     * @expectedOutput It survives the purge. Cleanup must be scoped to elapsed
     *                 windows only, or the limiter would reset on every request.
     */
    it("retains buckets that are still inside their window", async () => {
      const { checkPersistentRateLimit } = await import("@/lib/rate-limit");
      const { typedDb } = await import("@/lib/db/query");

      await typedDb.run(sql`DELETE FROM rate_limit_bucket`);
      await typedDb.insert(rateLimitBuckets).values({
        key: "pat:live-host",
        count: 2,
        windowStart: new Date(),
      });

      await checkPersistentRateLimit("other-host", 5, 60_000);

      const remaining = await typedDb
        .select()
        .from(rateLimitBuckets)
        .where(eq(rateLimitBuckets.key, "pat:live-host"));

      expect(remaining).toHaveLength(1);
      expect(remaining[0].count).toBe(2);
    });

    /**
     * @target checkPersistentRateLimit
     * @dependencies SQLite driver, rate_limit_bucket table
     * @scenario A short-window scope checks its limit while a long-window
     *           bucket from another scope is still live
     * @expectedOutput The long-window bucket survives. Purging on the calling
     *                 scope's window would delete a bucket that is still inside
     *                 another scope's window and hand that scope a fresh
     *                 allowance; the limiter would be bypassable by sending
     *                 one extra request to the short-window endpoint.
     */
    it("does not purge a long-window bucket from a short-window scope", async () => {
      const { checkPersistentRateLimit } = await import("@/lib/rate-limit");
      const { typedDb } = await import("@/lib/db/query");

      await typedDb.run(sql`DELETE FROM rate_limit_bucket`);
      await typedDb.insert(rateLimitBuckets).values({
        key: "pat:validate:198.51.100.7",
        count: 4,
        // Inside the 15 minute PAT window, but outside a 60 second window.
        windowStart: new Date(Date.now() - 5 * 60 * 1000),
      });

      await checkPersistentRateLimit("webhook:198.51.100.7", 5, 60_000);

      const remaining = await typedDb
        .select()
        .from(rateLimitBuckets)
        .where(eq(rateLimitBuckets.key, "pat:validate:198.51.100.7"));

      expect(remaining).toHaveLength(1);
      expect(remaining[0].count).toBe(4);
    });
  });
});
