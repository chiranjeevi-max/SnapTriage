/**
 * @module tests/unit/lib/db/db-clock
 *
 * `dbNowPlus` must produce the stored epoch-millisecond representation on the
 * SQLite driver. The fake DB evaluates the marker for the service tests; this
 * executes the real SQL, so a syntax or unit error cannot ship.
 */
import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { dbNowPlus } from "@/lib/db/db-clock";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
});

describe("dbNowPlus", () => {
  /**
   * @target dbNowPlus
   * @dependencies SQLite, unixepoch()
   * @scenario A deadline is built for an epoch-ms column
   * @expectedOutput The database returns epoch milliseconds about one second
   *                 ahead of the wall clock at execution time, truncated to the
   *                 second. `unixepoch()` is whole seconds, so the value may be
   *                 up to 999ms early; that is the conservative direction for a
   *                 lease.
   */
  it("should return epoch milliseconds from the SQLite clock", () => {
    const before = Date.now();
    const row = typedDb.get<{ value: number }>(sql`SELECT ${dbNowPlus(1000)} AS value`);
    const after = Date.now();

    // `unixepoch()` is whole seconds, so the value can be up to 999ms behind the
    // wall clock. That is the conservative direction for a lease: it expires
    // early, never late.
    expect(row.value).toBeGreaterThanOrEqual(before);
    expect(row.value).toBeLessThanOrEqual(after + 1000);
  });
});
