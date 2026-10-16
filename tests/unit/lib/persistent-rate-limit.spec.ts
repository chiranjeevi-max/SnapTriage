import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { unlinkSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
});
