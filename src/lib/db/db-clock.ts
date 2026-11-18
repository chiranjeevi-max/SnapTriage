/**
 * @module db/db-clock
 *
 * Deadlines stamped by the database's own clock, in the write that starts them.
 *
 * A JS-captured instant always precedes the write that carries it, so a stalled
 * write lands a deadline that much shorter than intended. The send lease must
 * not be shortened by its own write, so it is computed where the row is written.
 * The database's clock is also the clock every app instance shares, and the
 * release rule compares the lease against it.
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
 * A `dbNowPlus` fragment, with the millisecond offset carried for the test fake.
 *
 * The marker is part of the type, so a plain SQL fragment cannot be mistaken for
 * a database-clock deadline.
 */
export type DbNowPlus = SQL<number> & { readonly [DB_NOW_PLUS]: number };

/**
 * Epoch milliseconds `ms` after the instant the database writes the row.
 *
 * @param ms - Milliseconds after the write's own instant.
 * @returns An update `set` value for an epoch-ms column, on either driver.
 */
export function dbNowPlus(ms: number): DbNowPlus {
  const frag = process.env.DATABASE_URL
    ? // Postgres: `clock_timestamp()`. `now()` is frozen at the transaction's
      // start, so when a concurrent writer makes this update wait for the row
      // lock, the re-run that follows the wait (EvalPlanQual) would still report
      // the pre-wait instant. `clock_timestamp()` is re-evaluated then, so the
      // lease is stamped after the wait, at the write. A lock held without
      // updating the row would skip the re-run and keep the pre-wait value. This
      // app issues no `SELECT … FOR UPDATE` and its multi-statement transactions
      // never touch this table, so every wait it can meet is a concurrent
      // writer's. The cast keeps the result a bigint, which the schema's
      // epoch-ms columns store and the Neon type parser reads back as a number.
      sql<number>`((extract(epoch from clock_timestamp()) * 1000) + ${ms})::bigint`
    : // SQLite: whole seconds, so the instant is up to 999ms early. The error is
      // one-sided. The lease is never longer than designed, and never more than
      // 999ms shorter, which is noise against its 90s of slack.
      sql<number>`(unixepoch() * 1000 + ${ms})`;
  return Object.assign(frag, { [DB_NOW_PLUS]: ms });
}

/**
 * Whether a value is a `dbNowPlus` fragment.
 *
 * @param value - A write value or a condition operand.
 * @returns True when the marker is present.
 */
export function isDbNowPlus(value: unknown): value is DbNowPlus {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, DB_NOW_PLUS) === "number"
  );
}
