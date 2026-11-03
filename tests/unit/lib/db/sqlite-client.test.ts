/**
 * @module tests/unit/lib/db/sqlite-client.test.ts
 * Opening the SQLite file while another connection switches it to WAL, as
 * `next build`'s workers do when they all open a new file at once. SQLite then
 * fails the switch outright instead of waiting; the fake driver reproduces that.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const driver = vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  delete process.env.DATABASE_URL;
  return {
    failures: 0,
    code: "SQLITE_BUSY",
    waitFailures: 0,
    waitCode: "SQLITE_BUSY",
    calls: [] as string[],
  };
});

vi.mock("better-sqlite3", async (importOriginal) => {
  const { SqliteError } = (await importOriginal<{ default: typeof import("better-sqlite3") }>())
    .default;
  return {
    default: class {
      static SqliteError = SqliteError;
      pragma(source: string) {
        driver.calls.push(source);
        if (driver.failures > 0) {
          driver.failures--;
          throw new SqliteError("database is locked", driver.code);
        }
      }
      exec(source: string) {
        driver.calls.push(source);
        if (driver.waitFailures > 0) {
          driver.waitFailures--;
          throw new SqliteError("database is locked", driver.waitCode);
        }
      }
    },
  };
});

describe("the SQLite client", () => {
  beforeEach(() => {
    vi.resetModules();
    driver.calls = [];
    driver.code = "SQLITE_BUSY";
    driver.waitFailures = 0;
    driver.waitCode = "SQLITE_BUSY";
  });

  it("waits out a connection switching the file to WAL, then switches", async () => {
    driver.failures = 1;

    await import("@/lib/db");

    expect(driver.calls).toEqual([
      "journal_mode = WAL",
      "BEGIN IMMEDIATE; ROLLBACK",
      "journal_mode = WAL",
    ]);
  });

  it("still fails when the file stays locked", async () => {
    driver.failures = Infinity;

    await expect(import("@/lib/db")).rejects.toThrow("database is locked");
    expect(driver.calls.filter((call) => call === "journal_mode = WAL")).toHaveLength(3);
  });

  it("does not retry other errors", async () => {
    driver.failures = 1;
    driver.code = "SQLITE_IOERR";

    await expect(import("@/lib/db")).rejects.toMatchObject({ code: "SQLITE_IOERR" });
    expect(driver.calls).toEqual(["journal_mode = WAL"]);
  });

  it("keeps its remaining attempts when a wait for the lock times out", async () => {
    driver.failures = 2;
    driver.waitFailures = 1;

    await import("@/lib/db");

    expect(driver.calls).toEqual([
      "journal_mode = WAL",
      "BEGIN IMMEDIATE; ROLLBACK",
      "journal_mode = WAL",
      "BEGIN IMMEDIATE; ROLLBACK",
      "journal_mode = WAL",
    ]);
  });

  it("does not retry other errors while waiting", async () => {
    driver.failures = 1;
    driver.waitFailures = 1;
    driver.waitCode = "SQLITE_IOERR";

    await expect(import("@/lib/db")).rejects.toMatchObject({ code: "SQLITE_IOERR" });
    expect(driver.calls).toEqual(["journal_mode = WAL", "BEGIN IMMEDIATE; ROLLBACK"]);
  });
});
