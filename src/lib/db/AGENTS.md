# AGENTS.md — src/lib/db

Dual-driver Drizzle layer. SQLite default, Neon Postgres when `DATABASE_URL` is set.

## Rules

- Import `typedDb` from `src/lib/db/query.ts` + `* as schema`. Never import raw `db` or add casts.
- Schema source is `src/lib/db/schema.ts` (singular tables, UUID `crypto.randomUUID()` PKs, `timestamp_ms`, JSON `labels/assignees/pendingChanges`).
- Scope all app reads/writes by `userId`. Rely on `onDelete:cascade` (`repo→issue→triage_state`, `user→account/session/access_token`).
- `DATABASE_URL` empty = SQLite at `SQLITE_PATH` (`./data/snaptriage.db`, `mkdir -p` + WAL in `index.ts`). Set = Postgres. `drizzle.config.ts` mirrors this switch.
- Change flow: edit `schema.ts` → `npm run db:generate` → include `drizzle/*.sql` + `meta/` → `npm run db:migrate` locally.
- Tokens in `access_token` / `account` are AES-256-GCM. New rows are written as `v1:iv:tag:cipher` hex; rows written before the version tag existed (`iv:tag:cipher`) are still read. Encrypt on write, decrypt on read. No plaintext fallback for new rows.
- Rate limit state lives in `rate_limit_bucket`; upserts use their natural keys (the key already carries its scope, e.g. `pat:validate:<ip>`). Migrations and unique indexes must ship together.
- `webhook_delivery` records seen delivery IDs for replay protection; rows are purged after 7 days.
Done = `typecheck` + focused `vitest` + `db:generate` produces no unexpected diff.
