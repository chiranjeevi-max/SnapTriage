/**
 * @module tests/unit/lib/db/query.test.ts
 * `runTransaction` against a real in-memory SQLite database.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { runTransaction, typedDb } from "@/lib/db/query";
import { users } from "@/lib/db/schema";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
});

describe("runTransaction", () => {
  beforeAll(() => {
    migrate(typedDb, { migrationsFolder: join(process.cwd(), "drizzle") });
  });

  it("commits every write it is given", async () => {
    await runTransaction([
      typedDb.insert(users).values({ id: "first", name: "First" }),
      typedDb.insert(users).values({ id: "second", name: "Second" }),
    ]);

    expect(await typedDb.select({ id: users.id }).from(users).orderBy(users.id)).toEqual([
      { id: "first" },
      { id: "second" },
    ]);
  });

  it("rolls back every write when one of them fails", async () => {
    await typedDb.insert(users).values({ id: "existing", name: "Existing" });

    const writes = runTransaction([
      typedDb.insert(users).values({ id: "rolled-back", name: "Rolled back" }),
      typedDb.insert(users).values({ id: "existing", name: "Duplicate" }),
    ]);

    await expect(writes).rejects.toThrow(/UNIQUE constraint failed: user\.id/);
    expect(await typedDb.select().from(users).where(eq(users.id, "rolled-back"))).toEqual([]);
  });
});
