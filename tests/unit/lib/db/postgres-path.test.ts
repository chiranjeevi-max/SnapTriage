/* @vitest-environment node */
import { describe, it, expect, beforeAll } from "vitest";
import { migrate } from "drizzle-orm/neon-http/migrator";
import { join } from "node:path";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("Postgres path", () => {
  beforeAll(async () => {
    const { db } = await import("@/lib/db");
    await migrate(db as never, { migrationsFolder: join(process.cwd(), "drizzle") });
  });

  it("connects and queries through the Postgres client", async () => {
    const { typedDb } = await import("@/lib/db/query");
    const { sql } = await import("drizzle-orm");
    const result = await (typedDb as unknown as { execute: (query: unknown) => Promise<unknown> }).execute(sql`select 1 as value`);
    expect(result).toBeTruthy();
  });
});
