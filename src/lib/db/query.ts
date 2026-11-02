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

/** A built write that has not run yet: run it synchronously or await it. */
type PendingWrite = { run(): unknown } & PromiseLike<unknown>;

/**
 * Runs writes in one transaction when the driver supports it.
 *
 * The caller builds the writes and they only execute here. better-sqlite3
 * transactions must be synchronous: handed an async callback, it rolls back
 * and throws while the statements the callback awaited still run afterwards,
 * outside any transaction. The Neon HTTP driver cannot hold an interactive
 * transaction, so there the writes run in order without one.
 *
 * @param writes - Unexecuted Drizzle insert, update or delete queries.
 */
export async function runTransaction(writes: PendingWrite[]): Promise<void> {
  if (process.env.DATABASE_URL) {
    for (const write of writes) await write;
    return;
  }
  typedDb.transaction(() => {
    for (const write of writes) write.run();
  });
}
