/**
 * @module tests/unit/lib/db/query-neon.test.ts
 * `runTransaction` on the Neon driver, against a fake Neon HTTP client that
 * records the statements each request would carry.
 */
import { describe, it, expect, vi } from "vitest";
import { runTransaction, typedDb } from "@/lib/db/query";
import { users } from "@/lib/db/schema";

const neon = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://snaptriage@db.example.test/neondb";

  const requests: string[][] = [];
  const result = { rows: [], fields: [], rowCount: 1, command: "INSERT" };
  const client = {
    // A query only goes out on its own when it is awaited.
    query: (sql: string) => ({
      sql,
      then: (resolve: (value: typeof result) => void) => {
        requests.push([sql]);
        resolve(result);
      },
    }),
    transaction: async (queries: { sql: string }[]) => {
      requests.push(queries.map((query) => query.sql));
      return queries.map(() => result);
    },
  };
  return { client, requests };
});

vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@neondatabase/serverless")>()),
  neon: () => neon.client,
}));

describe("runTransaction on Neon", () => {
  it("sends every write in one transaction request", async () => {
    await runTransaction([
      typedDb.insert(users).values({ id: "first", name: "First" }),
      typedDb.insert(users).values({ id: "second", name: "Second" }),
    ]);

    const insertUser = expect.stringMatching(/^insert into "user"/);
    expect(neon.requests).toEqual([[insertUser, insertUser]]);
  });
});
