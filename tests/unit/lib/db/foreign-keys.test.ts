/**
 * @module tests/unit/lib/db/foreign-keys.test.ts
 *
 * `onDelete: cascade` is only a declaration until the connection turns SQLite's
 * foreign-key enforcement on, and SQLite's default is off. These exercise the
 * cascade against a real in-memory database: a mocked pragma call proves the
 * statement ran, not that a delete cascades.
 */
import { describe, it, expect, beforeAll, vi } from "vitest";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { typedDb } from "@/lib/db/query";
import { users, repos, issues, triageState, triagePresets } from "@/lib/db/schema";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
});

async function seedRepo(ids: { userId: string; repoId: string; issueId: string }) {
  await typedDb.insert(users).values({ id: ids.userId, name: ids.userId });
  await typedDb.insert(repos).values({
    id: ids.repoId,
    userId: ids.userId,
    provider: "github",
    owner: "acme",
    name: "widgets",
    fullName: "acme/widgets",
  });
  await typedDb.insert(issues).values({
    id: ids.issueId,
    repoId: ids.repoId,
    provider: "github",
    number: 1,
    title: "Broken",
    url: "https://example.test/acme/widgets/issues/1",
    providerIssueId: "1",
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

describe("foreign key enforcement", () => {
  beforeAll(() => {
    migrate(typedDb, { migrationsFolder: join(process.cwd(), "drizzle") });
  });

  /**
   * @target disconnectRepo's implicit cascade
   * @dependencies SQLite, PRAGMA foreign_keys
   * @scenario A repo is deleted while it still owns issues, triage state and a preset
   * @expectedOutput Every dependent row is gone. Without the pragma all of them
   *                 survive and a reconnect surfaces them as orphaned records.
   */
  it("cascades a repo delete to its dependent rows", async () => {
    await seedRepo({ userId: "cascade-user", repoId: "cascade-repo", issueId: "cascade-issue" });
    await typedDb.insert(triageState).values({ issueId: "cascade-issue", userId: "cascade-user" });
    await typedDb.insert(triagePresets).values({
      userId: "cascade-user",
      repoId: "cascade-repo",
      name: "Triage",
      actions: {},
    });

    await typedDb.delete(repos).where(eq(repos.id, "cascade-repo"));

    expect(await typedDb.select().from(issues).where(eq(issues.repoId, "cascade-repo"))).toEqual(
      []
    );
    expect(
      await typedDb.select().from(triageState).where(eq(triageState.issueId, "cascade-issue"))
    ).toEqual([]);
    expect(
      await typedDb.select().from(triagePresets).where(eq(triagePresets.repoId, "cascade-repo"))
    ).toEqual([]);
  });

  /**
   * @target the connection's pragma setting
   * @dependencies better-sqlite3
   * @scenario The app's own connection reports its foreign_keys state
   * @expectedOutput Enforcement is on, so the cascade above cannot be accidental.
   */
  it("reports foreign key enforcement as on", () => {
    const row = typedDb.get<{ foreign_keys: number }>(sql`PRAGMA foreign_keys`);

    expect(row.foreign_keys).toBe(1);
  });

  /**
   * @target the schema's repoId foreign key
   * @dependencies SQLite
   * @scenario An issue is inserted against a repo that does not exist
   * @expectedOutput The write is refused instead of creating a row that no repo owns.
   */
  it("rejects an issue whose repo does not exist", async () => {
    await typedDb.insert(users).values({ id: "orphan-user", name: "Orphan" });

    await expect(
      typedDb.insert(issues).values({
        repoId: "missing-repo",
        provider: "github",
        number: 2,
        title: "Orphan",
        url: "https://example.test/orphan",
        providerIssueId: "2",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });
});
