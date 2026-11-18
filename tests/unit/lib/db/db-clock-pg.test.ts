/**
 * @module tests/unit/lib/db/db-clock-pg
 *
 * The Postgres branch of `dbNowPlus` through the real Neon client, with only
 * `fetch` faked. This pins the emitted SQL: `clock_timestamp()` is re-evaluated
 * after a concurrent writer's lock wait, while `now()` stays frozen at the
 * transaction's start.
 *
 * It does not prove server-side evaluation ordering; that is a PostgreSQL engine
 * fact. A real lock-wait test needs a second concurrent session, which Neon's
 * HTTP driver cannot hold.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { replyDrafts } from "@/lib/db/schema";
import { dbNowPlus } from "@/lib/db/db-clock";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://snaptriage@db.example.test/neondb";
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("dbNowPlus on Postgres", () => {
  /**
   * @target dbNowPlus
   * @dependencies Neon client, Drizzle Postgres dialect
   * @scenario The lease is written through the real Neon query builder
   * @expectedOutput The SQL uses `clock_timestamp()`, never `now()`, and binds
   *                 the lease length. `now()` would be the transaction start,
   *                 which a concurrent writer's lock wait can precede.
   */
  it("should emit clock_timestamp(), not now(), in the claim update", async () => {
    let sent = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        sent = typeof init?.body === "string" ? init.body : "";
        return Response.json({ command: "UPDATE", rowCount: 1, fields: [], rows: [] });
      })
    );

    await typedDb
      .update(replyDrafts)
      .set({ sendInFlightUntil: dbNowPlus(120_000) })
      .where(and(eq(replyDrafts.issueId, "issue-1"), eq(replyDrafts.userId, "user-1")));

    expect(sent).toContain("clock_timestamp()");
    expect(sent).not.toMatch(/\bnow\(\)/);
    expect(sent).toContain("120000");
  });
});
