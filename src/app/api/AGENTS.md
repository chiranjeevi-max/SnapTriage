# AGENTS.md — src/app/api

Session-guarded REST layer. All routes `force-dynamic`.

## Rules

- Guard with `auth()` from `src/auth.ts`. Return 401 when no `session.user.id`. Keep `userId` scoping on every query.
- Parse bodies with `parseBody(schema, body)` from `src/lib/validations.ts` (`triagePatchSchema`, `connectRepoSchema`, `syncTriggerSchema`, `tokenValidationSchema`). Return 400 with joined message on failure.
- `PATCH /api/issues/[id]`: honor `syncMode` — `live` writes to provider now with optimistic rollback, `batch` stages in `pendingChanges` + sets `batchPending`.
- Token writes go through `encrypt()`; reads through `decrypt()`. IP for PAT limiter comes from `x-real-ip ?? x-forwarded-for[0]`.
- Log via `apiLogger` / `authLogger` from `src/lib/logger.ts` (Pino, JSON in prod). No tokens in logs.
- Provider writeback failures must surface to the client as non-2xx responses.
- `proxy.ts` owns route gating (`/inbox,/repos,/settings` → `/login`). Don't re-implement redirects in handlers.
Done = `lint + typecheck` + route-level test or `curl` against dev server + `build` if matcher/touching auth.
