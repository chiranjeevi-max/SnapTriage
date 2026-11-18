/**
 * @module db/db-clock
 *
 * Deadlines stamped by the database's own clock, in the write that starts them.
 *
 * A JS-captured instant always precedes the write that carries it, so a stalled
 * write lands a deadline that much shorter than intended. The send lease is a
 * deadline that must not be shortened by its own write, so it is computed where
 * the row is written. The database's clock is also the one clock every app
 * instance shares, which is what the release rule compares against.
 *
 * The dialect is read from the same environment variable `db/index.ts` uses;
 * importing the client itself would build a real database in unit tests, where
 * `typedDb` is faked and `DATABASE_URL` is unset.
 */
import { sql, type SQL } from "drizzle-orm";

/**
 * Marker the unit-test fake reads to evaluate the fragment at apply time.
 *
 * The fake is not a SQL engine; the symbol carries the semantics (epoch ms from
 * now plus a constant) so the fake computes it when the write lands, which is
 * the entire point of using the database's clock.
 */
export const DB_NOW_PLUS = Symbol("dbNowPlus");

/**
 * Epoch milliseconds `ms` after the instant the database writes the row.
 *
 * @param ms - Milliseconds after the write's own instant.
 * @returns An update `set` value for an epoch-ms column, on either driver.
 */
export function dbNowPlus(ms: number): SQL<number> {
  const frag = process.env.DATABASE_URL
    ? // Postgres: `now()` is the statement's transaction start in an autocommit
      // update; the cast keeps the result a bigint, which the schema's epoch-ms
      // columns store and the Neon type parser reads back as a number.
      sql<number>`((extract(epoch from now()) * 1000) + ${ms})::bigint`
    : // SQLite: whole seconds, so the instant is up to 999ms early. That is
      // conservative against the lease and noise against its 90s of slack.
      sql<number>`(unixepoch() * 1000 + ${ms})`;
  return Object.assign(frag, { [DB_NOW_PLUS]: ms });
}
