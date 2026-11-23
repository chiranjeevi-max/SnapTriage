/**
 * @module tests/unit/app/api/issues/route-filter.test.ts
 *
 * `GET /api/issues` narrows the queue to a repo when asked. A filter that
 * cannot match must narrow to nothing — widening to every repo turns a stale
 * id into the whole queue, which the user reads as the filter having stopped
 * working.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { typedDb } from "@/lib/db/query";
import { issues, repos, users } from "@/lib/db/schema";
import { GET } from "@/app/api/issues/route";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
});

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "filter-user" } })),
}));

function seedIssue(id: string, repoId: string, number: number) {
  return {
    id,
    repoId,
    provider: "github",
    number,
    title: `Issue ${number}`,
    url: `https://example.test/${repoId}/${number}`,
    providerIssueId: `${repoId}-${number}`,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };
}

async function listIssues(query: string) {
  const response = await GET(new Request(`http://localhost/api/issues${query}`));
  return (await response.json()) as Array<{ id: string }>;
}

describe("GET /api/issues repo filter", () => {
  beforeAll(async () => {
    migrate(typedDb, { migrationsFolder: join(process.cwd(), "drizzle") });
    await typedDb.insert(users).values({ id: "filter-user", name: "Filter" });
    for (const [id, name] of [
      ["filter-repo-a", "a"],
      ["filter-repo-b", "b"],
    ]) {
      await typedDb.insert(repos).values({
        id,
        userId: "filter-user",
        provider: "github",
        owner: "acme",
        name,
        fullName: `acme/${name}`,
      });
    }
    await typedDb
      .insert(issues)
      .values([
        seedIssue("filter-issue-a", "filter-repo-a", 1),
        seedIssue("filter-issue-b", "filter-repo-b", 2),
      ]);
  });

  /**
   * @target GET /api/issues
   * @dependencies none
   * @scenario No repo filter
   * @expectedOutput Every issue the user has, so the filter is opt-in.
   */
  it("returns every repo's issues without a filter", async () => {
    const rows = await listIssues("");

    expect(rows.map((row) => row.id).sort()).toEqual(["filter-issue-a", "filter-issue-b"]);
  });

  /**
   * @target GET /api/issues
   * @dependencies none
   * @scenario A repo the user does own
   * @expectedOutput Only that repo's issues.
   */
  it("narrows to a repo the user owns", async () => {
    const rows = await listIssues("?repoId=filter-repo-a");

    expect(rows.map((row) => row.id)).toEqual(["filter-issue-a"]);
  });

  /**
   * @target GET /api/issues
   * @dependencies none
   * @scenario A repo id that matches nothing — deleted, stale, or mistyped
   * @expectedOutput No issues. Returning the whole queue would make the filter
   *                 look like it silently stopped applying.
   */
  it("returns nothing for a repo id the user does not own", async () => {
    const rows = await listIssues("?repoId=does-not-exist");

    expect(rows).toEqual([]);
  });
});
