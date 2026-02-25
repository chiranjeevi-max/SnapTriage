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
import Database from "better-sqlite3";
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
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
    // Serverless Postgres via Neon — used on Vercel
    const sql = neon(databaseUrl);
    return drizzleNeon(sql, { schema });
  }

  // Local SQLite — used in development and Docker self-host
  const sqlitePath = process.env.SQLITE_PATH ?? "./data/snaptriage.db";
  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  return drizzleSqlite(sqlite, { schema });
}

/** Singleton database client used throughout the application. */
export const db = createDb();
