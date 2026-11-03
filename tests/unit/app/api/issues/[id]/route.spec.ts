/**
 * @module tests/unit/app/api/issues/[id]/route.spec.ts
 * PATCH /api/issues/:id refuses values the provider would misread before it
 * writes anything. Runs against a real in-memory database.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { typedDb } from "@/lib/db/query";
import { issues, repos, triageState, users } from "@/lib/db/schema";
import { PATCH } from "@/app/api/issues/[id]/route";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
});

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "route-user" } })),
}));

describe("PATCH /api/issues/:id", () => {
  beforeAll(async () => {
    migrate(typedDb, { migrationsFolder: join(process.cwd(), "drizzle") });
    await typedDb.insert(users).values({ id: "route-user", name: "Route user" });
    await typedDb.insert(repos).values({
      id: "gitlab-repo",
      userId: "route-user",
      provider: "gitlab",
      owner: "group",
      name: "app",
      fullName: "group/app",
      permission: "write",
    });
    await typedDb.insert(issues).values({
      id: "gitlab-issue",
      repoId: "gitlab-repo",
      provider: "gitlab",
      number: 5,
      title: "Crash on save",
      url: "https://gitlab.com/group/app/-/issues/5",
      providerIssueId: "9001",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
  });

  it("refuses a GitLab label containing a comma before changing anything", async () => {
    const response = await PATCH(
      new Request("http://localhost/api/issues/gitlab-issue", {
        method: "PATCH",
        body: JSON.stringify({ priority: 1, labels: { add: ["bug,security"] } }),
      }),
      { params: Promise.resolve({ id: "gitlab-issue" }) }
    );

    expect(response.status).toBe(400);
    expect(
      await typedDb.select().from(triageState).where(eq(triageState.issueId, "gitlab-issue"))
    ).toEqual([]);
  });
});
