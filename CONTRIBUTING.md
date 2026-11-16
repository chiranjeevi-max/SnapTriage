# Contributing to SnapTriage

Thanks for your interest in contributing to SnapTriage!

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/chiranjeevi-max/SnapTriage.git
   cd SnapTriage
   ```

2. **Install dependencies**

   ```bash
   npm ci
   ```

3. **Set up environment variables**

   ```bash
   cp .env.example .env.local
   ```

   Fill in the required values (see `.env.example` for documentation).

4. **Run the development server**

   ```bash
   npm run dev
   ```

5. **Run the checks**

   ```bash
   npm run format:check  # Prettier, including markdown
   npm run lint          # ESLint
   npm run typecheck     # TypeScript
   npm test              # Unit tests (Vitest)
   ```

   That is the order CI runs them in. `npm run build` needs `AUTH_SECRET` set to any value.

## Project Structure

```
src/
├── app/          # Next.js App Router pages and API routes
├── components/   # Shared UI components (shadcn/ui)
├── features/     # One folder per feature: auth, inbox, triage, keyboard, sync,
│                 # repos, presets, replies, follow-up, webhooks, landing, dev-tools
└── lib/          # Core libraries (db, github, gitlab, providers)
```

## Guidelines

### Code Style

- TypeScript strict mode
- Prettier for formatting (run `npm run format`)
- ESLint for linting (run `npm run lint`)
- Use `@/` path aliases for imports

### Commits

- Write clear, descriptive commit messages
- Keep commits focused on a single change
- Reference issue numbers where applicable

### Pull Requests

- Create a feature branch from `main`
- Write tests for new functionality
- Ensure all checks pass (`npm run lint && npm run typecheck && npm test && npm run build`)
- Fill out the PR template
- Keep PRs focused and reasonably sized

### Testing

- Unit tests (Vitest): `tests/unit/`
- E2E tests (Playwright): `tests/e2e/` (set `E2E_GITHUB_PAT` for authenticated coverage)
- Write tests for business logic, especially triage actions and sync engine

### Database changes

A migration is only correct when both dialects carry it. Edit `src/lib/db/schema.ts` and `src/lib/db/schema.pg.ts`, run `npm run db:generate`, and commit both output folders. CI re-runs `db:generate` and fails if either changed, and `tests/unit/lib/db/schema-parity.test.ts` catches the case where only one schema was edited.

## Architecture

SnapTriage uses a feature-based folder structure. Each feature is self-contained with its own components, hooks, and logic.

Key patterns:

- **TanStack Query** for all server state (caching, polling, optimistic updates)
- **Zustand** for client-only UI state (keyboard selection, modal states)
- **Provider abstraction** (`IssueProvider` interface) for GitHub/GitLab interchangeability
- **Drizzle ORM** with SQLite (default) or Postgres

Before changing the sync, reply, or follow-up code, read the invariants at the top of `AGENTS.md`. They record the write ordering, the send-claim rules, and what a detection pass may not touch; each one exists because getting it wrong shipped a bug.

## Reporting Issues

- Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template for bugs
- Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template for ideas

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
