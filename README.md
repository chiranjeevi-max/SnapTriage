# SnapTriage

[![CI](https://github.com/your-org/snaptriage/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/snaptriage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Keyboard-driven inbox for triaging GitHub & GitLab issues at speed.** Think "Superhuman for issue triage."

## Quick Start

```bash
# Clone and install
git clone https://github.com/your-org/snaptriage.git
cd snaptriage
npm install

# Configure environment
cp .env.example .env.local
# Edit .env.local with your GitHub/GitLab OAuth credentials

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Features

- **Keyboard-first** — Navigate and triage issues entirely from the keyboard
- **Multi-provider** — Connect GitHub and GitLab repos in one unified inbox
- **Optimistic UI** — Actions feel instant with automatic rollback on failure
- **Undo** — Every action has a 5-second undo window
- **Two sync modes** — Live (instant writeback) or Batch (stage changes, push when ready)
- **Label & assignee pickers** — Searchable command palettes for quick editing
- **Snooze** — Hide issues until a specific time
- **Dark mode** — Dark theme by default, light and system themes available
- **Self-hostable** — SQLite by default, Postgres optional. Docker Compose included.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `J` / `K` | Navigate down / up |
| `Enter` / `Escape` | Open / close detail |
| `1` - `4` | Set priority P0-P3 |
| `D` | Dismiss / undismiss |
| `L` | Edit labels |
| `A` | Edit assignees |
| `S` | Snooze issue |
| `Z` | Undo last action |
| `R` | Sync issues |
| `Shift+P` | Push batch changes |
| `?` | Show all shortcuts |

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) + TypeScript |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Database | SQLite (default) + Postgres via Drizzle ORM |
| Auth | Auth.js — GitHub/GitLab OAuth + PAT fallback |
| State | TanStack Query + Zustand |
| Testing | Vitest + Playwright |

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm run lint` | Run ESLint |
| `npm run typecheck` | TypeScript type check |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run E2E tests |
| `npm run format` | Format with Prettier |
| `npm run db:generate` | Generate Drizzle migrations |
| `npm run db:migrate` | Run migrations |
| `npm run db:studio` | Open Drizzle Studio |

## Deploy

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fyour-org%2Fsnaptriage&env=AUTH_SECRET,AUTH_GITHUB_ID,AUTH_GITHUB_SECRET&envDescription=Required%20environment%20variables&project-name=snaptriage)

### Docker

```bash
docker compose -f docker/docker-compose.yml up
```

SQLite data is persisted in a Docker volume. See `.env.example` for all configuration options.

## Environment Variables

See [`.env.example`](.env.example) for the full list. Required variables:

| Variable | Description |
|----------|-------------|
| `AUTH_SECRET` | Random secret for Auth.js session encryption |
| `AUTH_GITHUB_ID` | GitHub OAuth App client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret |

Optional:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | Postgres connection string | (uses SQLite) |
| `SQLITE_PATH` | SQLite database file path | `./data/snaptriage.db` |
| `AUTH_GITLAB_ID` | GitLab OAuth App ID | |
| `AUTH_GITLAB_SECRET` | GitLab OAuth App secret | |
| `AUTH_GITLAB_URL` | Self-hosted GitLab URL | `https://gitlab.com` |
| `SYNC_INTERVAL_MS` | Auto-sync interval | `300000` (5 min) |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
