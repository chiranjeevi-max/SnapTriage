/**
 * @module tests/unit/app/api/repos/[id]/route.test.ts
 *
 * A destructive route must not report success for a row it did not touch.
 * Both handlers are scoped to the owning user, so "not found" and "someone
 * else's" are the same answer — but neither may be `{ ok: true }`.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { typedDb } from "@/lib/db/query";
import { issues, repos, users } from "@/lib/db/schema";
import { DELETE, PATCH } from "@/app/api/repos/[id]/route";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
});

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "repos-user" } })),
}));

function context(id: string) {
  return { params: Promise.resolve({ id }) };
}

function patchRequest(body: unknown) {
  return new Request("http://localhost/api/repos/some-repo", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/repos/[id]", () => {
  beforeAll(async () => {
    migrate(typedDb, { migrationsFolder: join(process.cwd(), "drizzle") });
    await typedDb.insert(users).values([
      { id: "repos-user", name: "Repos" },
      { id: "other-user", name: "Other" },
    ]);
    await typedDb.insert(repos).values([
      {
        id: "owned-repo",
        userId: "repos-user",
        provider: "github",
        owner: "acme",
        name: "owned",
        fullName: "acme/owned",
      },
      {
        id: "foreign-repo",
        userId: "other-user",
        provider: "github",
        owner: "acme",
        name: "foreign",
        fullName: "acme/foreign",
      },
    ]);
    await typedDb.insert(issues).values({
      id: "owned-issue",
      repoId: "owned-repo",
      provider: "github",
      number: 1,
      title: "Issue",
      url: "https://example.test/1",
      providerIssueId: "1",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  /**
   * @target DELETE /api/repos/:id
   * @dependencies none
   * @scenario The id matches no repo of the caller's
   * @expectedOutput 404, not `{ ok: true }`. A client holding a stale id would
   *                 otherwise show a repo as disconnected while it is still there.
   */
  it("answers an unknown repo id with 404", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/repos/missing"),
      context("missing")
    );

    expect(response.status).toBe(404);
  });

  /**
   * @target DELETE /api/repos/:id
   * @dependencies none
   * @scenario The repo belongs to another user
   * @expectedOutput 404 and the row survives, so the ownership guard cannot be
   *                 probed by status code.
   */
  it("answers another user's repo with 404 and deletes nothing", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/repos/foreign-repo"),
      context("foreign-repo")
    );

    expect(response.status).toBe(404);
    expect(await typedDb.select().from(repos).where(eq(repos.id, "foreign-repo"))).toHaveLength(1);
  });

  /**
   * @target DELETE /api/repos/:id
   * @dependencies disconnectRepo
   * @scenario The caller's own repo
   * @expectedOutput `{ ok: true }`, and the repo's issues go with it.
   */
  it("disconnects the caller's repo", async () => {
    const response = await DELETE(
      new Request("http://localhost/api/repos/owned-repo"),
      context("owned-repo")
    );

    expect(response.status).toBe(200);
    expect(await typedDb.select().from(repos).where(eq(repos.id, "owned-repo"))).toEqual([]);
    expect(await typedDb.select().from(issues).where(eq(issues.repoId, "owned-repo"))).toEqual([]);
  });

  /**
   * @target PATCH /api/repos/:id
   * @dependencies updateRepo
   * @scenario The repo id matches nothing
   * @expectedOutput 404. Reporting success would leave the client believing a
   *                 setting was saved when nothing was written.
   */
  it("answers an unknown repo id on update with 404", async () => {
    const response = await PATCH(patchRequest({ syncMode: "batch" }), context("missing"));

    expect(response.status).toBe(404);
  });
});
