/**
 * @module tests/unit/lib/db/neon-client.test.ts
 * Rows read through the real Neon HTTP client, with only `fetch` faked. The
 * fake answers as Neon's server does: every value as Postgres text, typed by
 * the field's type OID.
 */
import { describe, it, expect, vi } from "vitest";
import { typedDb } from "@/lib/db/query";
import { rateLimitBuckets } from "@/lib/db/schema";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://snaptriage@db.example.test/neondb";
});

const TEXT = 25;
const INT4 = 23;
const INT8 = 20;

describe("the Neon client", () => {
  it("reads bigint epoch milliseconds back as dates", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          command: "SELECT",
          rowCount: 1,
          fields: [
            { name: "key", dataTypeID: TEXT },
            { name: "count", dataTypeID: INT4 },
            { name: "windowStart", dataTypeID: INT8 },
          ],
          rows: [["pat:validate:203.0.113.7", "3", "1730000000000"]],
        })
      )
    );

    const rows = await typedDb.select().from(rateLimitBuckets);

    expect(rows).toEqual([
      { key: "pat:validate:203.0.113.7", count: 3, windowStart: new Date(1730000000000) },
    ]);
  });
});
