/**
 * @module db/query
 *
 * Type-safe database client. Asserts the union-typed `db` as a
 * BetterSQLite3Database because both drivers share identical query
 * builder APIs (.select/.insert/.update/.delete). The cast happens
 * ONCE here instead of 45 times across 12 files.
 */
import { db } from "./index";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const typedDb: BetterSQLite3Database<typeof schema> = db as unknown as BetterSQLite3Database<
  typeof schema
>;

/**
 * Run writes with a transaction when the driver supports it.
 * The Neon HTTP driver cannot use interactive transactions, so fall back to
 * direct (non-transactional) writes there.
 */
export async function runTransaction<T>(
  callback: (tx: BetterSQLite3Database<typeof schema>) => Promise<T>
): Promise<T> {
  if (process.env.DATABASE_URL) {
    return callback(typedDb);
  }
  return typedDb.transaction(callback as never);
}
