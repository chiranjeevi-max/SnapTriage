/**
 * @module tests/unit/app/api/views/[id]/route.test.ts
 *
 * Deleting a saved view must say whether it deleted anything. The route is
 * scoped to the caller, so an unknown id and another user's id are the same
 * answer — and neither is `{ ok: true }`.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { typedDb } from "@/lib/db/query";
import { savedViews, users } from "@/lib/db/schema";
import { DELETE } from "@/app/api/views/[id]/route";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
});

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "views-user" } })),
}));

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/views/[id]", () => {
  beforeAll(async () => {
    migrate(typedDb, { migrationsFolder: join(process.cwd(), "drizzle") });
    await typedDb.insert(users).values([
      { id: "views-user", name: "Views" },
      { id: "other-user", name: "Other" },
    ]);
    await typedDb.insert(savedViews).values([
      { id: "owned-view", userId: "views-user", name: "Urgent", filter: "urgent" },
      { id: "foreign-view", userId: "other-user", name: "Theirs", filter: "open" },
    ]);
  });

  /**
   * @target DELETE /api/views/:id
   * @dependencies none
   * @scenario The id matches no view of the caller's
   * @expectedOutput 404 rather than a success that changed no row.
   */
  it("answers an unknown view id with 404", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/views/missing"),
      context("missing")
    );

    expect(response.status).toBe(404);
  });

  /**
   * @target DELETE /api/views/:id
   * @dependencies none
   * @scenario The view belongs to another user
   * @expectedOutput 404 and the row survives.
   */
  it("answers another user's view with 404 and deletes nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/views/foreign-view"),
      context("foreign-view")
    );

    expect(response.status).toBe(404);
    expect(
      await typedDb.select().from(savedViews).where(eq(savedViews.id, "foreign-view"))
    ).toHaveLength(1);
  });

  /**
   * @target DELETE /api/views/:id
   * @dependencies none
   * @scenario The caller's own view
   * @expectedOutput `{ ok: true }` and the row is gone.
   */
  it("deletes the caller's view", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/views/owned-view"),
      context("owned-view")
    );

    expect(response.status).toBe(200);
    expect(await typedDb.select().from(savedViews).where(eq(savedViews.id, "owned-view"))).toEqual(
      []
    );
  });
});
