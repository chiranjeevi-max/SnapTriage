/**
 * @module db/query
 *
 * Type-safe database client. Asserts the union-typed `db` as a
 * BetterSQLite3Database because both drivers share identical query
 * builder APIs (.select/.insert/.update/.delete). The cast happens
 * ONCE here instead of 45 times across 12 files.
 */
import { db } from "./index";
import type { BatchItem } from "drizzle-orm/batch";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const typedDb: BetterSQLite3Database<typeof schema> = db as unknown as BetterSQLite3Database<
  typeof schema
>;

/** A built write that has not run yet. */
type PendingWrite = { run(): unknown };

/**
 * Runs writes in one transaction.
 *
 * The caller builds the writes and they only execute here. better-sqlite3
 * transactions must be synchronous: handed an async callback, it rolls back
 * and throws while the statements the callback awaited still run afterwards,
 * outside any transaction. The Neon HTTP driver cannot hold an interactive
 * transaction, so there the writes go out as one batch, which Neon runs as a
 * single transaction.
 *
 * @param writes - Unexecuted Drizzle insert, update or delete queries.
 */
export async function runTransaction(writes: PendingWrite[]): Promise<void> {
  if (db instanceof NeonHttpDatabase) {
    // The Neon client built these queries; only typedDb's type calls them SQLite.
    await db.batch(writes as unknown as [BatchItem<"pg">, ...BatchItem<"pg">[]]);
    return;
  }
  typedDb.transaction(() => {
    for (const write of writes) write.run();
  });
}
