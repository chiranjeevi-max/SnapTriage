# Contributing to SnapTriage

Thanks for your interest in contributing to SnapTriage! This document provides guidelines and instructions for contributing.

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-username/snaptriage.git
   cd snaptriage
   ```

2. **Install dependencies**

   ```bash
   npm install
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

5. **Run tests**

   ```bash
   npm test          # Unit tests
   npm run typecheck  # TypeScript check
   npm run lint       # ESLint
   ```

## Project Structure

```
src/
├── app/          # Next.js App Router pages and API routes
├── components/   # Shared UI components (shadcn/ui)
├── features/     # Feature modules (auth, inbox, triage, keyboard, sync, repos)
├── lib/          # Core libraries (db, github, gitlab, providers)
└── hooks/        # Shared React hooks
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

- **Unit tests**: `tests/unit/` — Vitest
- **E2E tests**: `tests/e2e/` — Playwright
- Write tests for business logic, especially triage actions and sync engine

## Architecture

SnapTriage uses a feature-based folder structure. Each feature (`auth`, `inbox`, `triage`, `keyboard`, `sync`, `repos`) is self-contained with its own components, hooks, and logic.

Key patterns:
- **TanStack Query** for all server state (caching, polling, optimistic updates)
- **Zustand** for client-only UI state (keyboard selection, modal states)
- **Provider abstraction** (`IssueProvider` interface) for GitHub/GitLab interchangeability
- **Drizzle ORM** with SQLite (default) or Postgres

## Reporting Issues

- Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) template for bugs
- Use the [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) template for ideas

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
