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
