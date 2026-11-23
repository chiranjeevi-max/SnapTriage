/* @vitest-environment node */
/**
 * @module tests/unit/features/follow-up/ordering.test.ts
 *
 * Which rows one check pass selects, against a real database.
 *
 * The scheduler orders by `attemptedAt` and relies on a never-attempted row
 * leading the batch. SQLite sorts NULL below every value; Postgres sorts it above
 * on an ascending order. The fake DB models only SQLite, so this runs the real
 * SQL — the divergence it catches is invisible to the rest of the suite and it
 * silently starved freshly armed follow-ups on Neon.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { and, eq, or, isNull, lt, sql } from "drizzle-orm";

describe("follow-up scheduling order", () => {
  const dbPath = join(tmpdir(), `snaptriage-followup-order-${Date.now()}.db`);

  beforeAll(async () => {
    process.env.SQLITE_PATH = dbPath;
    process.env.AUTH_SECRET = "test-secret";
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const { db } = await import("@/lib/db");
    migrate(db as never, { migrationsFolder: join(process.cwd(), "drizzle") });

    const { typedDb } = await import("@/lib/db/query");
    const { users, repos, issues, followUps } = await import("@/lib/db/schema");

    await typedDb.insert(users).values({ id: "order-user", name: "Order" });
    await typedDb.insert(repos).values({
      id: "order-repo",
      userId: "order-user",
      provider: "github",
      owner: "acme",
      name: "widgets",
      fullName: "acme/widgets",
    });

    // Twenty attempted rows and one that has never been attempted, which is what
    // a freshly armed follow-up looks like: `armFollowUp` does not set
    // `attemptedAt`.
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (let index = 0; index < 20; index++) {
      const issueId = `attempted-issue-${index}`;
      await typedDb.insert(issues).values({
        id: issueId,
        repoId: "order-repo",
        provider: "github",
        number: index + 1,
        title: `Attempted ${index}`,
        url: `https://example.test/${index}`,
        providerIssueId: `gh-${index}`,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      });
      await typedDb.insert(followUps).values({
        id: `attempted-follow-${index}`,
        issueId,
        userId: "order-user",
        state: "waiting",
        attemptedAt: hourAgo,
        checkedAt: hourAgo,
      });
    }

    await typedDb.insert(issues).values({
      id: "fresh-issue",
      repoId: "order-repo",
      provider: "github",
      number: 99,
      title: "Freshly armed",
      url: "https://example.test/99",
      providerIssueId: "gh-99",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    });
    await typedDb.insert(followUps).values({
      id: "fresh-follow",
      issueId: "fresh-issue",
      userId: "order-user",
      state: "waiting",
    });
  }, 30000);

  afterAll(() => {
    for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
      try {
        unlinkSync(file);
      } catch {
        // cleanup best effort
      }
    }
  });

  /**
   * @target runFollowUpCheck's batch selection
   * @dependencies SQLite, coalesce
   * @scenario Twenty previously attempted rows are due, and a twenty-first row
   *           has never been attempted
   * @expectedOutput The never-attempted row is in the batch. Ordering by the bare
   *                 column puts NULL first on SQLite and *last* on Postgres, so
   *                 the bare order only passed here and starved the new row on
   *                 Neon: the batch refilled with the same twenty every pass.
   */
  it("puts a never-attempted row ahead of attempted ones", async () => {
    const { typedDb } = await import("@/lib/db/query");
    const { followUps } = await import("@/lib/db/schema");

    const cutoff = new Date(Date.now() - 60 * 1000);
    const due = or(isNull(followUps.attemptedAt), lt(followUps.attemptedAt, cutoff));

    const rows = await typedDb
      .select({ id: followUps.id })
      .from(followUps)
      .where(and(eq(followUps.userId, "order-user"), eq(followUps.state, "waiting"), due))
      .orderBy(sql`coalesce(${followUps.attemptedAt}, 0)`, followUps.checkedAt)
      .limit(20);

    expect(rows).toHaveLength(20);
    expect(rows[0].id).toBe("fresh-follow");
  }, 30000);

  /**
   * @target the same ordering without the coalesce
   * @dependencies SQLite
   * @scenario The bare column order on SQLite
   * @expectedOutput The never-attempted row also leads here — which is why the
   *                 bug could not reproduce on the default deployment, and why
   *                 this ordering had to be made explicit rather than relying on
   *                 each driver's default.
   */
  it("leads with NULL on SQLite even without coalesce", async () => {
    const { typedDb } = await import("@/lib/db/query");
    const { followUps } = await import("@/lib/db/schema");

    const rows = await typedDb
      .select({ id: followUps.id })
      .from(followUps)
      .where(eq(followUps.userId, "order-user"))
      .orderBy(followUps.attemptedAt)
      .limit(1);

    expect(rows[0].id).toBe("fresh-follow");
  }, 30000);
});
