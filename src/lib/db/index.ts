/**
 * @module db
 *
 * Database client factory with dual-driver support.
 *
 * Selects the database backend at startup based on environment variables:
 * - **Postgres (Neon):** Used when `DATABASE_URL` is set. Ideal for Vercel / serverless.
 * - **SQLite (better-sqlite3):** Default fallback for local development and self-hosted
 *   Docker deployments. Path configurable via `SQLITE_PATH` (default `./data/snaptriage.db`).
 *
 * WAL mode is enabled on SQLite for concurrent read performance.
 */
import { mkdirSync } from "fs";
import { dirname, resolve } from "path";
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon, types } from "@neondatabase/serverless";
import * as schema from "./schema";

/** Union type representing either SQLite or Neon (Postgres) Drizzle client. */
export type DbClient = BetterSQLite3Database<typeof schema> | NeonHttpDatabase<typeof schema>;

/**
 * Creates the appropriate Drizzle ORM client based on the runtime environment.
 * @returns A fully-configured Drizzle client bound to the chosen database.
 */
function createDb(): DbClient {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    // Serverless Postgres via Neon, used on Vercel. Rows are read through the
    // SQLite column types, which take epoch milliseconds as numbers, so bigint
    // must parse to one; Neon's default is a string. The values stay far below
    // 2^53. Neon's HTTP queries only read this global parser registry.
    types.setTypeParser(types.builtins.INT8, Number);
    const sql = neon(databaseUrl);
    return drizzleNeon(sql, { schema });
  }

  // Local SQLite, used in development and Docker self-host
  const sqlitePath = process.env.SQLITE_PATH ?? "./data/snaptriage.db";
  // Ensure the parent directory exists (e.g. ./data/) before SQLite tries to open the file.
  // This is needed both on first run and during Next.js build-time static analysis.
  mkdirSync(resolve(dirname(sqlitePath)), { recursive: true });
  const sqlite = new Database(sqlitePath);
  enableWal(sqlite);
  return drizzleSqlite(sqlite, { schema });
}

/**
 * Switches a SQLite file to WAL, a setting the file keeps.
 *
 * `next build` opens a new file from several workers at once. The switch
 * upgrades a read lock to a write lock, and SQLite refuses that upgrade outright,
 * rather than waiting, while another connection is committing its own switch.
 * `BEGIN IMMEDIATE` asks for the write lock afresh, which does wait out the busy
 * timeout, so the retry after it finds the file already in WAL.
 */
function enableWal(sqlite: Database.Database) {
  for (let attempt = 1; ; attempt++) {
    try {
      sqlite.pragma("journal_mode = WAL");
      return;
    } catch (error) {
      const busy = error instanceof Database.SqliteError && error.code === "SQLITE_BUSY";
      if (!busy || attempt === 3) throw error;
      sqlite.exec("BEGIN IMMEDIATE; ROLLBACK");
    }
  }
}

/** Singleton database client used throughout the application. */
export const db = createDb();
