# SnapTriage

[![CI](https://github.com/chiranjeevi-max/snaptriage/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/chiranjeevi-max/snaptriage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Keyboard-driven inbox for triaging GitHub and GitLab issues fast.** Think "Superhuman for issue triage."

## Vision

One inbox. Every repo. Zero mouse. SnapTriage treats GitHub and GitLab issues like mail: optimistic by default, and fast enough to clear a hundred-issue backlog before your coffee gets cold.

## Problem

Issue triage is slow. GitHub and GitLab give you browsing UIs, not processing UIs. You click into an issue, click a label dropdown, scroll, click, go back, repeat. Multiply that across a dozen repos and two providers, and triage becomes the task nobody wants to do. Backlogs grow. Signal gets buried in noise.

## Who It's For

- **Open-source maintainers** drowning in issues across multiple repos
- **Engineering leads** who need to prioritize and route work fast
- **DevRel and community teams** who triage bug reports and feature requests daily
- **Solo developers** who want their side-project issues under control

> **Note:** SnapTriage is currently a personal triage tool. Multiple users can sign in to the same deployment, but each person gets their own inbox and triage state. Shared team queues and collaboration features are [on the roadmap](#roadmap).

## Features

- **Keyboard-first**: navigate and triage issues entirely from the keyboard
- **Customizable shortcuts**: rebind any key from the `?` overlay
- **Multi-provider**: connect GitHub and GitLab repos in one unified inbox
- **Optimistic UI**: actions feel instant with automatic rollback on failure
- **Undo**: every action has a 5-second undo window
- **Two sync modes**: live (instant writeback) or batch (stage changes, push when ready)
- **Webhook sync**: connect GitHub/GitLab webhooks to trigger an instant repo sync
- **Label & assignee pickers**: searchable command palettes for quick editing
- **Saved views**: keep named inbox filters (all, open, dismissed, snoozed, urgent) for one-click switching
- **Snooze**: hide issues until a specific time
- **Secure by default**: Personal Access Tokens and sensitive credentials are AES-256 encrypted at rest
- **Dark mode**: dark theme by default, light and system themes available
- **Self-hostable**: SQLite by default, Postgres optional. Docker Compose included.

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

## Quick Start

```bash
git clone https://github.com/chiranjeevi-max/SnapTriage.git
cd SnapTriage
# Requires Node 22 (see the engines field in package.json); CI uses the same version
npm ci
cp .env.example .env.local
# Edit .env.local with your GitHub/GitLab OAuth credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

> **Multi-user note:** A single deployment supports multiple users. Each person signs in with their own GitHub/GitLab account and gets an independent inbox. There is no shared triage state between users yet.

### Vercel

Requires a Postgres database (e.g. [Neon](https://neon.tech)) since SQLite is not compatible with serverless environments. Set `DATABASE_URL` in your environment variables.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fchiranjeevi-max%2Fsnaptriage&env=AUTH_SECRET,AUTH_GITHUB_ID,AUTH_GITHUB_SECRET&envDescription=Required%20environment%20variables&project-name=snaptriage)

### Docker

Uses SQLite by default, so no external database is required.

```bash
docker compose -f docker/docker-compose.yml up
```

SQLite data is persisted in a Docker volume. See `.env.example` for all configuration options.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Database | SQLite (default) + Postgres via Drizzle ORM |
| Auth | Auth.js, GitHub/GitLab OAuth + PAT fallback (encrypted) |
| State | TanStack Query + Zustand |
| Logging | Pino (structured JSON logger) |
| Testing | Vitest + Playwright |

## Roadmap

SnapTriage is production-ready today. What's next:

- [ ] **AI-assisted triage**: auto-suggest labels, priority, and assignees based on issue content
- [x] **Saved filters & views**: custom inbox views with persistent filter sets
- [ ] **Team sync**: shared triage queues with real-time presence
- [ ] **Jira & Linear providers**: extend the provider abstraction beyond GitHub/GitLab
- [x] **Bulk actions**: select multiple issues, apply changes in one shot
- [x] **Webhooks**: real-time sync via webhooks alongside polling
- [ ] **Browser extension**: triage sidebar on GitHub/GitLab issue pages
- [ ] **Mobile-friendly view**: responsive triage for on-the-go processing

<details>
<summary><strong>Scripts</strong></summary>

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

</details>

<details>
<summary><strong>Environment Variables</strong></summary>

See [`.env.example`](.env.example) for the full list. Required:

| Variable | Description |
|----------|-------------|
| `AUTH_SECRET` | Secret for Auth.js session and AES key derivation |
| `AUTH_GITHUB_ID` | GitHub OAuth App client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret |

Optional:

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_URL` | Base URL for Auth.js callbacks | `http://localhost:3000` |
| `AUTH_SALT` | Cryptographic salt for AES encryption | (Defaults to internal) |
| `DATABASE_URL` | Postgres connection string | (uses SQLite) |
| `SQLITE_PATH` | SQLite database file path | `./data/snaptriage.db` |
| `AUTH_GITLAB_ID` | GitLab OAuth App ID | |
| `AUTH_GITLAB_SECRET` | GitLab OAuth App secret | |
| `AUTH_GITLAB_URL` | Self-hosted GitLab URL | `https://gitlab.com` |
| `SYNC_INTERVAL_MS` | Auto-sync interval | `300000` (5 min) |
| `WEBHOOK_SECRET` | Shared secret for GitHub/GitLab webhook sync, passed as `?secret=` | (webhook sync disabled) |

</details>

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## Documentation

For more detail on how SnapTriage works:
- [Architecture & Tech Stack](docs/architecture.md)
- [Security Overview](docs/security.md)

## License

[MIT](LICENSE)
