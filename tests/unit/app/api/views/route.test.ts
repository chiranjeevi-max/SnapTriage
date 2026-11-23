/**
 * @module tests/unit/app/api/views/route.test.ts
 *
 * A request body that is not valid JSON is a client error, not a server one.
 * Every sibling route reads the body through `req.json().catch(() => null)` for
 * exactly this reason: without it a truncated body or a missing one throws out
 * of the handler and surfaces as a 500.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { typedDb } from "@/lib/db/query";
import { savedViews, users } from "@/lib/db/schema";
import { POST } from "@/app/api/views/route";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
});

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "views-user" } })),
}));

function createRequest(body: string) {
  return new Request("http://localhost/api/views", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("POST /api/views", () => {
  beforeAll(async () => {
    migrate(typedDb, { migrationsFolder: join(process.cwd(), "drizzle") });
    await typedDb.insert(users).values({ id: "views-user", name: "Views user" });
  });

  /**
   * @target POST /api/views
   * @dependencies none
   * @scenario The body is truncated JSON
   * @expectedOutput 400 and nothing stored. The handler does not throw, which
   *                 would surface as a 500 for a request the client can fix.
   */
  it("answers a malformed body with 400", async () => {
    const response = await POST(createRequest('{"name":"Urgent","filter":'));

    expect(response.status).toBe(400);
    expect(await typedDb.select().from(savedViews)).toEqual([]);
  });

  /**
   * @target POST /api/views
   * @dependencies none
   * @scenario No body at all
   * @expectedOutput 400 rather than a thrown parse error.
   */
  it("answers an empty body with 400", async () => {
    const response = await POST(createRequest(""));

    expect(response.status).toBe(400);
  });

  /**
   * @target POST /api/views
   * @dependencies none
   * @scenario A well-formed body
   * @expectedOutput 201 and the view is stored for the caller, so the catch
   *                 above does not swallow valid requests.
   */
  it("stores a valid view", async () => {
    const response = await POST(
      createRequest(JSON.stringify({ name: "Urgent", filter: "urgent" }))
    );

    expect(response.status).toBe(201);
    const stored = await typedDb
      .select()
      .from(savedViews)
      .where(eq(savedViews.userId, "views-user"));
    expect(stored).toEqual([expect.objectContaining({ name: "Urgent", filter: "urgent" })]);
  });
});
