# AGENTS.md — SnapTriage

Keyboard-driven inbox for triaging GitHub + GitLab issues. Next.js 16 App Router + React 19 + TypeScript strict + Drizzle ORM.

## Commands

Run from repo root with `npm` (CI uses `npm ci`, Node 22):

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
10. Keep PAT rate limiting on the shared `rate_limit_bucket` table and purge expired rows; do not reintroduce per-instance-only limits.
## Style

- TypeScript `strict:true`, `target:ES2017`, `jsx:react-jsx`.
- Prettier: double quotes, semicolons, 2-space, `printWidth:100`, `trailingComma:es5`. Run `npm run format` before commit.
- `eslint-config-next/core-web-vitals` + `eslint-config-prettier`. No `--fix` in CI.

## DB

- Default is SQLite (`SQLITE_PATH`, default `./data/snaptriage.db`, WAL). Setting `DATABASE_URL` switches to Neon Postgres. Same Drizzle schema (`src/lib/db/schema.ts`).
- Never hand-edit `drizzle/*.sql`. Change schema, run `db:generate`, include migration.
- Details: `src/lib/db/AGENTS.md`.

## API / Auth

- All `/api/*` except `api/auth/[...nextauth]` require session via `auth()`. `proxy.ts` protects `/inbox,/repos,/settings` → `/login`.
- PAT rate limit is 5/15min per IP on `POST /api/auth/token`.
- New external image/API hosts need CSP update in `next.config.ts`.
- Details: `src/app/api/AGENTS.md`.

## Read on demand

| Mention | Read |
|---|---|
| sync modes, deployment, providers | `docs/architecture.md` |
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
