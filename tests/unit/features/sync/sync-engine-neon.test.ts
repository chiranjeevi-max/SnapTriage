/**
 * @module tests/unit/features/sync/sync-engine-neon.test.ts
 * The issue upsert `syncRepo` sends to Neon. SQLite matches column names
 * whatever their case, so only the SQL bound for Postgres, which folds unquoted
 * names to lower case, shows whether the `excluded` columns are quoted.
 */
import { describe, it, expect, vi } from "vitest";

const neon = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://snaptriage@db.example.test/neondb";
  process.env.AUTH_SECRET = "test-secret";
  const sent: string[] = [];
  let respond: (sql: string) => unknown[][] = () => [];
  return {
    sent,
    setRows(fn: (sql: string) => unknown[][]) {
      respond = fn;
    },
    client: {
      query: (sql: string) => ({
        then(resolve: (value: unknown) => void) {
          sent.push(sql);
          const rows = respond(sql);
          resolve({ rows, fields: [], rowCount: rows.length, command: "" });
        },
      }),
    },
  };
});

vi.mock("@neondatabase/serverless", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@neondatabase/serverless")>()),
  neon: () => neon.client,
}));

describe("syncRepo on Neon", () => {
  it("quotes the camel-case columns its upsert takes from excluded", async () => {
    const { encrypt } = await import("@/lib/crypto");
    const { syncRepo } = await import("@/features/sync/sync-engine");
    const token = encrypt("ghp-sync");
    const created = 1730000000000;
    // Rows come back in each table's column order, as Neon returns them.
    neon.setRows((sql) => {
      if (sql.startsWith('select "id", "userId", "provider", "owner"'))
        return [
          [
            "repo-1",
            "user-1",
            "github",
            "octocat",
            "hello",
            "octocat/hello",
            "write",
            true,
            "live",
            null,
            created,
          ],
        ];
      if (sql.startsWith('select "id", "userId", "provider", "providerAccountId", "token"'))
        return [["token-1", "user-1", "github", "github.com/1", token, "github-pat", created]];
      return [];
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          {
            id: 999,
            number: 1,
            title: "Crash on save",
            body: null,
            user: { login: "alice", avatar_url: "https://example.com/alice.png" },
            state: "open",
            labels: [],
            assignees: [],
            html_url: "https://github.com/octocat/hello/issues/1",
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-02T00:00:00.000Z",
          },
        ])
      )
    );

    await expect(syncRepo("repo-1", "user-1")).resolves.toMatchObject({ status: "completed" });

    const upsert = neon.sent.find((sql) => sql.startsWith('insert into "issue"'));
    expect(upsert).toContain('"authorAvatar" = excluded."authorAvatar"');
    expect(upsert).toContain('"updatedAt" = excluded."updatedAt"');
    expect(upsert).toContain('"fetchedAt" = excluded."fetchedAt"');
    expect(upsert).not.toMatch(/excluded\.[A-Za-z]/);
  });
});
