# AGENTS.md — src/app/api

Session-guarded REST layer. All routes `force-dynamic`.

## Rules

- Guard with `auth()` from `src/auth.ts`. Return 401 when no `session.user.id`. Keep `userId` scoping on every query.
- Parse bodies with `parseBody(schema, body)` from `src/lib/validations.ts` (`triagePatchSchema`, `connectRepoSchema`, `syncTriggerSchema`, `tokenValidationSchema`). Return 400 with joined message on failure.
- `PATCH /api/issues/[id]`: honor `syncMode` — `live` writes to provider now with optimistic rollback, `batch` stages in `pendingChanges` + sets `batchPending`.
- Token writes go through `encrypt()`; reads through `decrypt()`. Rate-limit keys come from `rateLimitKey(req, scope)` in `src/lib/request-context.ts`, which only trusts `x-forwarded-for` when `TRUSTED_PROXY_HOPS` says how many proxies append to it; unattributable traffic shares one bucket.
- Log via `apiLogger` / `authLogger` from `src/lib/logger.ts` (Pino, JSON in prod). No tokens in logs.
- Provider writeback failures must surface to the client as non-2xx responses.
- `proxy.ts` owns route gating (`/inbox,/repos,/settings` → `/login`). Don't re-implement redirects in handlers.
Done = `lint + typecheck` + route-level test or `curl` against dev server + `build` if matcher/touching auth.
