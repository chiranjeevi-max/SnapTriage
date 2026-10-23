# AGENTS.md: src/app/api

Session-guarded REST layer. All routes `force-dynamic`.

## Rules

- Guard with `auth()` from `src/auth.ts`. Return 401 when no `session.user.id`. Keep `userId` scoping on every query.
- Parse bodies with `parseBody(schema, body)` from `src/lib/validations.ts` (`triagePatchSchema`, `connectRepoSchema`, `syncTriggerSchema`, `tokenValidationSchema`). Return 400 with joined message on failure.
- `PATCH /api/issues/[id]`: honor `syncMode`; `live` writes to provider now with optimistic rollback, `batch` stages in `pendingChanges` + sets `batchPending`.
- Keep the issue payload split. `GET /api/issues` returns the queue fields only; descriptions are large and only the open pane needs one, so they come from `GET /api/issues/[id]`. Re-adding `body` to the list query puts megabytes back on every poll.
- Validate provider-bound values against the provider's own limits (`providerLimits` in `src/lib/provider-interface.ts`) before writing anything. A label longer than GitHub accepts must fail the request, not the writeback after the triage state already changed.
- Token writes go through `encrypt()`; reads through `decrypt()`. Rate-limit keys come from `rateLimitKey(req, scope)` in `src/lib/request-context.ts`, which only trusts `x-forwarded-for` when `TRUSTED_PROXY_HOPS` says how many proxies append to it; unattributable traffic shares one bucket.
- Log via `apiLogger` / `authLogger` from `src/lib/logger.ts` (Pino, JSON in prod). No tokens in logs.
- Provider writeback failures must surface to the client as non-2xx responses.
- `proxy.ts` owns route gating (`/inbox,/repos,/settings` → `/login`). Don't re-implement redirects in handlers.
Done = `lint + typecheck` + route-level test or `curl` against dev server + `build` if matcher/touching auth.
