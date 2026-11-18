/* @vitest-environment node */
import { describe, it, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { join } from "node:path";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("Postgres path", () => {
  beforeAll(async () => {
    const { db } = await import("@/lib/db");
    await migrate(db as never, { migrationsFolder: join(process.cwd(), "drizzle-pg") });
  });

  it("connects and queries through the Postgres client", async () => {
    const { typedDb } = await import("@/lib/db/query");
    const { sql } = await import("drizzle-orm");
    const result = await (
      typedDb as unknown as { execute: (query: unknown) => Promise<unknown> }
    ).execute(sql`select 1 as value`);
    expect(result).toBeTruthy();
  });

  /**
   * @target dbNowPlus
   * @dependencies Postgres, clock_timestamp()
   * @scenario The clock fragment is executed by the server
   * @expectedOutput Epoch milliseconds about one second ahead of the app clock.
   *                 This upgrades the SQLite-only execution test to Postgres
   *                 when a database is available; it still does not prove
   *                 ordering under a lock wait, which needs a second session.
   */
  it("executes the clock fragment server-side", async () => {
    const { dbNowPlus } = await import("@/lib/db/db-clock");
    const { sql } = await import("drizzle-orm");
    const { typedDb } = await import("@/lib/db/query");
    const before = Date.now();
    const result = (await (
      typedDb as unknown as { execute: (query: unknown) => Promise<{ rows?: unknown[][] }> }
    ).execute(sql`SELECT ${dbNowPlus(1000)} AS value`)) as { rows?: unknown[][] };
    const value = Number(result.rows?.[0]?.[0]);

    expect(value).toBeGreaterThanOrEqual(before);
    expect(value).toBeLessThanOrEqual(Date.now() + 1000);
  });
});
