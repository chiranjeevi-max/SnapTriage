# AGENTS.md — SnapTriage

Keyboard-driven inbox for triaging GitHub + GitLab issues. Next.js 16 App Router + React 19 + TypeScript strict + Drizzle ORM.

## Commands

Run from repo root with `npm` (CI uses `npm ci`, Node 26):

- Install: `npm ci`
- Dev: `npm run dev` (`cp .env.example .env.local` first, needs `AUTH_SECRET`)
- Build: `npm run build` (needs `AUTH_SECRET=...` even in CI)
- Lint: `npm run lint`
- Format check: `npm run format:check` (only `src/**/*.{ts,tsx}`)
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Unit: `npm test` (`vitest run`)
- Single file: `npx vitest run tests/unit/<name>.test.ts`
- E2E: `npm run test:e2e` (needs dev server on `:3000`, Chromium only)
- DB: `npm run db:generate` / `npm run db:migrate` / `npm run db:studio`

CI order: `format:check` → `lint` → `typecheck` → `test` → `build`. No E2E in CI.

## Invariants

These override statistical defaults. Follow them exactly.

1. Keep `src/auth.config.ts` edge-safe. No `node:crypto`, `fs`, Drizzle, or `lib/crypto` imports there. Full server setup lives in `src/auth.ts`.
2. Use `typedDb` from `src/lib/db/query.ts` for all app queries. Never add new `db as` casts. The single cast lives in `query.ts:13`.
3. Scope every `repo` / `issue` / `triage_state` query by `userId`. Cascade deletes are assumed.
4. Validate mutating API bodies with `parseBody` + Zod schemas from `src/lib/validations.ts`.
5. Encrypt tokens before `insert` with `encrypt()` from `src/lib/crypto.ts`, decrypt after `select`. Never log tokens. Auth failures log `{ip, provider}` only.
6. Server state goes in TanStack Query (`staleTime: 60s`, `refetchOnWindowFocus: false`). Ephemeral UI (selection, pickers, undo) goes in Zustand. See `src/components/providers.tsx`.
7. `live` writes through to the provider immediately with optimistic rollback. `batch` stages in `triage_state.pendingChanges` and flushes on explicit push. Respect `repos.syncMode`.
8. Import with `@/*` (`src/*` per `tsconfig.json:22`). Keep `@module` JSDoc on touched modules.
9. Provider writes must propagate failures; live sync and batch push must surface provider errors rather than swallowing them. UPSERT keys are issue `(repoId, providerIssueId)` and access token `(userId, provider)`.
10. Keep PAT rate limiting on the shared `rate_limit_bucket` table and purge expired rows; do not reintroduce per-instance-only limits. Keys carry their scope (`pat:validate:<ip>`), and the purge horizon must be the longest window in use so one scope cannot reset another.
11. Webhook auth is header-borne only: `X-Hub-Signature-256` (HMAC over the raw body) for GitHub, `X-Gitlab-Token` for GitLab. Never accept a secret in a query string.
## Style

- TypeScript `strict:true`, `target:ES2017`, `jsx:react-jsx`.
- Prettier: double quotes, semicolons, 2-space, `printWidth:100`, `trailingComma:es5`. Run `npm run format` before commit.
- `eslint-config-next/core-web-vitals` + `eslint-config-prettier`. No `--fix` in CI.
- One design language across the app. Reuse the shared pieces in `src/components/` (wordmark, page header, empty state, segmented control, select field) and the tokens in `docs/architecture.md` ("Design Language"). Sans for human sentences, mono for machine data. Never edit `src/components/ui/*` primitives to get there — wrap them.

## DB

- Default is SQLite (`SQLITE_PATH`, default `./data/snaptriage.db`, WAL). Setting `DATABASE_URL` switches to Neon Postgres. Same Drizzle schema (`src/lib/db/schema.ts`).
- Never hand-edit `drizzle/*.sql`. Change schema, run `db:generate`, include migration.
- Details: `src/lib/db/AGENTS.md`.

## API / Auth

- All `/api/*` except `api/auth/[...nextauth]` require session via `auth()`. `proxy.ts` protects `/inbox,/repos,/settings` → `/login`.
- PAT rate limit is 5/15min per IP on `POST /api/auth/token` and on the credentials callback, in separate scopes so one sign-in does not spend both allowances.
- The client IP for rate limiting comes from `x-forwarded-for`, trusted only as deep as `TRUSTED_PROXY_HOPS` says. Unattributable traffic shares one bucket.
- The Content-Security-Policy is nonce-based and built in `src/lib/csp.ts`, applied per request by `src/proxy.ts`. Keep `script-src` free of `'unsafe-inline'`; pages stay `force-dynamic` so the nonce can be stamped.
- New external image/API hosts need a CSP update in `src/lib/csp.ts`.
- `GET /api/issues` carries the queue fields only. Issue descriptions load per issue from `GET /api/issues/[id]`, so the list stays small no matter how many issues a user has.
- Validate anything written back to a provider against that provider's real limits (`providerLimits` in `src/lib/provider-interface.ts`). Never accept a value the provider will reject.
- Details: `src/app/api/AGENTS.md`.

## Read on demand

| Mention | Read |
|---|---|
| sync modes, deployment, providers | `docs/architecture.md` |
| design language, shared UI pieces, `?data=` fixtures | `docs/architecture.md` ("Design Language") |
| tokens, CSP, rate limit | `docs/security.md` |
| setup, PR checks | `CONTRIBUTING.md` |
| env vars | `.env.example` |
| human overview | `README.md` |

## Validation

Change is complete when:

- `npm run lint && npm run typecheck && npm test` exit 0, plus affected single-file test if touched.
- `npm run build` passes for route / config / DB changes.
- New behavior ships with a test in the same commit (`tests/unit/` for logic, `tests/e2e/` for flows).
- No new `@ts-ignore`, `eslint-disable`, `test.skip`/`.only`, or weakened assertions to get green. Fix source, not assertion. Stop after 2 unexplained failures and report.

## Don't

- Never commit `.env*`, secrets, or `*.db*`. Never force-push `main`.
- Never edit `drizzle/*` output, `.next/`, or `src/components/ui/*` primitives directly — wrap them.
- Never mock auth/payment providers in E2E. Never delete a failing test.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
