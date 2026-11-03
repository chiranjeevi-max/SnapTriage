# AGENTS.md: src/lib/db

Dual-driver Drizzle layer. SQLite default, Neon Postgres when `DATABASE_URL` is set.

## Rules

- Import `typedDb` from `src/lib/db/query.ts` + `* as schema`. Never import raw `db` or add casts.
- Schema source is `src/lib/db/schema.ts` (singular tables, UUID `crypto.randomUUID()` PKs, `timestamp_ms`, JSON `labels/assignees/pendingChanges`).
- Scope all app reads/writes by `userId`. Rely on `onDelete:cascade` (`repo→issue→triage_state`, `user→account/session/access_token`).
- `DATABASE_URL` empty = SQLite at `SQLITE_PATH` (`./data/snaptriage.db`, `mkdir -p` + WAL in `index.ts`). Set = Postgres, migrated from `drizzle-pg/`. `drizzle.config.ts` mirrors this switch.
- Change flow: edit `schema.ts` and its Postgres copy `schema.pg.ts` → `npm run db:generate` (writes `drizzle/` and `drizzle-pg/`) → include both folders' `*.sql` + `meta/` → `npm run db:migrate` locally. `tests/unit/lib/db/schema-parity.test.ts` fails when the two schemas differ.
- The app reads Postgres through the SQLite column types, so `schema.pg.ts` stores what they write: epoch milliseconds as `bigint` (parsed to numbers in `index.ts`), booleans as `boolean`, JSON as `text`. Raw SQL names columns with `sql.identifier()`, since Postgres folds an unquoted `updatedAt` to `updatedat`.
- Tokens in `access_token` / `account` are AES-256-GCM. New rows are written as `v1:iv:tag:cipher` hex; rows written before the version tag existed (`iv:tag:cipher`) are still read. Encrypt on write, decrypt on read. No plaintext fallback for new rows.
- Rate limit state lives in `rate_limit_bucket`; upserts use their natural keys (the key already carries its scope, e.g. `pat:validate:<ip>`). Migrations and unique indexes must ship together.
- `webhook_delivery` records seen delivery IDs for replay protection; rows are purged after 7 days.
Done = `typecheck` + focused `vitest` + `db:generate` produces no unexpected diff.
