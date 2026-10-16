/* @vitest-environment node */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { join } from "node:path";

const databaseUrl = process.env.DATABASE_URL;

describe("Postgres path", () => {
  it.skip(!databaseUrl, "requires DATABASE_URL");

  beforeAll(async () => {
    if (!databaseUrl) return;
    const { db } = await import("@/lib/db");
    await migrate(db, { migrationsFolder: join(process.cwd(), "drizzle") });
  });

  it("connects and queries through the Postgres client", async () => {
    if (!databaseUrl) return;
    const { typedDb } = await import("@/lib/db/query");
    const { sql } = await import("drizzle-orm");
    const result = await typedDb.execute(sql`select 1 as value`);
    expect(result).toBeTruthy();
  });
});
