import Database from "better-sqlite3";
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

export type DbClient = BetterSQLite3Database<typeof schema> | NeonHttpDatabase<typeof schema>;

function createDb(): DbClient {
  const databaseUrl = process.env.DATABASE_URL;

  if (databaseUrl) {
    const sql = neon(databaseUrl);
    return drizzleNeon(sql, { schema });
  }

  const sqlitePath = process.env.SQLITE_PATH ?? "./data/snaptriage.db";
  const sqlite = new Database(sqlitePath);
  sqlite.pragma("journal_mode = WAL");
  return drizzleSqlite(sqlite, { schema });
}

export const db = createDb();
