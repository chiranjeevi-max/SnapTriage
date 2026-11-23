/**
 * @module tests/unit/app/api/batch/pending-count/route.test.ts
 *
 * The batch badge count. Counted in the database rather than by reading rows: the
 * client polls this every thirty seconds, and each row carries its whole
 * `pendingChanges` JSON blob.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { typedDb } from "@/lib/db/query";
import { issues, repos, triageState, users } from "@/lib/db/schema";
import { GET } from "@/app/api/batch/pending-count/route";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
});

vi.mock("@/auth", () => ({
  auth: vi.fn(async () => ({ user: { id: "count-user" } })),
}));

async function pendingCount() {
  const response = await GET();
  return (await response.json()) as { count: number };
}

describe("GET /api/batch/pending-count", () => {
  beforeAll(async () => {
    migrate(typedDb, { migrationsFolder: join(process.cwd(), "drizzle") });

    await typedDb.insert(users).values([
      { id: "count-user", name: "Count" },
      { id: "other-user", name: "Other" },
    ]);
    await typedDb.insert(repos).values({
      id: "count-repo",
      userId: "count-user",
      provider: "github",
      owner: "acme",
      name: "widgets",
      fullName: "acme/widgets",
    });

    for (let index = 0; index < 3; index++) {
      const issueId = `count-issue-${index}`;
      await typedDb.insert(issues).values({
        id: issueId,
        repoId: "count-repo",
        provider: "github",
        number: index + 1,
        title: `Issue ${index}`,
        url: `https://example.test/${index}`,
        providerIssueId: `gh-${index}`,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
    }

    await typedDb.insert(triageState).values([
      // Two pending for the caller.
      { issueId: "count-issue-0", userId: "count-user", batchPending: true },
      { issueId: "count-issue-1", userId: "count-user", batchPending: true },
      // Not pending: triaged but already pushed.
      { issueId: "count-issue-2", userId: "count-user", batchPending: false },
    ]);
  });

  /**
   * @target GET /api/batch/pending-count
   * @dependencies count()
   * @scenario Two of the caller's three triage rows are pending
   * @expectedOutput `{ count: 2 }`. The unpushed row is excluded, so the badge
   *                 cannot overstate the work.
   */
  it("counts only the caller's pending rows", async () => {
    expect(await pendingCount()).toEqual({ count: 2 });
  });

  /**
   * @target GET /api/batch/pending-count
   * @dependencies count()
   * @scenario Every pending row is pushed
   * @expectedOutput `{ count: 0 }` — a number, not `null`, so the bar hides
   *                 rather than rendering an undefined count.
   */
  it("reports zero when nothing is staged", async () => {
    await typedDb.update(triageState).set({ batchPending: false });

    expect(await pendingCount()).toEqual({ count: 0 });

    await typedDb
      .update(triageState)
      .set({ batchPending: true })
      .where(eq(triageState.issueId, "count-issue-0"));
  });
});
