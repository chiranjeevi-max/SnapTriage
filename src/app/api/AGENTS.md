# AGENTS.md: src/app/api

Session-guarded REST layer. All routes `force-dynamic`.

## Rules

- Guard with `auth()` from `src/auth.ts`. Return 401 when no `session.user.id`. Keep `userId` scoping on every query.
- Parse bodies with `parseBody(schema, body)` from `src/lib/validations.ts` (`triagePatchSchema`, `connectRepoSchema`, `syncTriggerSchema`, `tokenValidationSchema`). Return 400 with joined message on failure.
- `PATCH /api/issues/[id]`: honor `syncMode`; `live` writes to provider now with optimistic rollback, `batch` stages in `pendingChanges` + sets `batchPending`.
- Keep the issue payload split. `GET /api/issues` returns the queue fields only; descriptions are large and only the open pane needs one, so they come from `GET /api/issues/[id]`. Re-adding `body` to the list query puts megabytes back on every poll.
- Validate provider-bound values against the provider's own limits (`providerLimits` in `src/lib/provider-interface.ts`) before writing anything. A label longer than GitHub accepts must fail the request, not the writeback after the triage state already changed. GitLab label names cannot contain commas, since GitLab splits label lists on them. Comment bodies have their own cap (GitHub 65,536 / GitLab 1,000,000); `sendReply` checks it, since the repository is only known there.
- Token writes go through `encrypt()`; reads through `decrypt()`. Rate-limit keys come from `rateLimitKey(req, scope)` in `src/lib/request-context.ts`, which only trusts `x-forwarded-for` when `TRUSTED_PROXY_HOPS` says how many proxies append to it; unattributable traffic shares one bucket.
- Log via `apiLogger` / `authLogger` from `src/lib/logger.ts` (Pino, JSON in prod). No tokens in logs.
- Provider writeback failures must surface to the client as non-2xx responses.
- `POST /api/issues/[id]/replies` is the only endpoint that creates something a third party can see. It must never retry, and a possibly-accepted comment must return 409 with `{ unconfirmed: true }` so the client withholds Send. See invariant 14 in the root `AGENTS.md`.
- The follow-up and reply routes are deliberately separate from `PATCH /api/issues/[id]`. A follow-up is not a triage decision, and folding it in would let an unrelated triage retry re-arm a watch.
- `GET /api/issues/[id]/comments` returns `supported: false` when the provider implements no comment API. Never return an empty thread for that case: "nobody replied" and "we cannot see" lead a maintainer to different actions.
- `proxy.ts` owns route gating (`/inbox,/repos,/settings` → `/login`). Don't re-implement redirects in handlers.
Done = `lint + typecheck` + route-level test or `curl` against dev server + `build` if matcher/touching auth.
