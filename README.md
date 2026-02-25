# SnapTriage

[![CI](https://github.com/chiranjeevi-max/snaptriage/actions/workflows/ci.yml/badge.svg)](https://github.com/chiranjeevi-max/snaptriage/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Keyboard-driven inbox for triaging GitHub & GitLab issues at speed.** Think "Superhuman for issue triage."

## Vision

One inbox. Every repo. Zero mouse. SnapTriage brings the speed of a keyboard-driven email client to issue management — unified across GitHub and GitLab, optimistic by default, and fast enough to clear a hundred-issue backlog before your coffee gets cold.

## Problem

Issue triage is slow. GitHub and GitLab give you browsing UIs, not processing UIs. You click into an issue, click a label dropdown, scroll, click, go back, repeat. Multiply that across a dozen repos and two providers, and triage becomes the task nobody wants to do. Backlogs grow. Signal gets buried in noise.

## Who It's For

- **Open-source maintainers** drowning in issues across multiple repos
- **Engineering leads** who need to prioritize and route work fast
- **DevRel and community teams** who triage bug reports and feature requests daily
- **Solo developers** who want their side-project issues under control

> **Note:** SnapTriage is currently a personal triage tool. Multiple users can sign in to the same deployment, but each person gets their own inbox and triage state. Shared team queues and collaboration features are [on the roadmap](#roadmap).

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

## Quick Start

```bash
git clone https://github.com/chiranjeevi-max/SnapTriage.git
cd SnapTriage
npm install
cp .env.example .env.local
# Edit .env.local with your GitHub/GitLab OAuth credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploy

> **Multi-user note:** A single deployment supports multiple users — each person signs in with their own GitHub/GitLab account and gets an independent inbox. There is no shared triage state between users yet.

### Vercel

Requires a Postgres database (e.g. [Neon](https://neon.tech)) since SQLite is not compatible with serverless environments. Set `DATABASE_URL` in your environment variables.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fchiranjeevi-max%2Fsnaptriage&env=AUTH_SECRET,AUTH_GITHUB_ID,AUTH_GITHUB_SECRET&envDescription=Required%20environment%20variables&project-name=snaptriage)

### Docker

Uses SQLite by default — no external database required.

```bash
docker compose -f docker/docker-compose.yml up
```

SQLite data is persisted in a Docker volume. See `.env.example` for all configuration options.

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 15 (App Router) + TypeScript |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Database | SQLite (default) + Postgres via Drizzle ORM |
| Auth | Auth.js — GitHub/GitLab OAuth + PAT fallback |
| State | TanStack Query + Zustand |
| Testing | Vitest + Playwright |

## Roadmap

SnapTriage is production-ready today. Here's where it's headed:

- [ ] **AI-assisted triage** — Auto-suggest labels, priority, and assignees based on issue content
- [ ] **Saved filters & views** — Custom inbox views with persistent filter sets
- [ ] **Team sync** — Shared triage queues with real-time presence
- [ ] **Jira & Linear providers** — Extend the provider abstraction beyond GitHub/GitLab
- [ ] **Bulk actions** — Select multiple issues, apply changes in one shot
- [ ] **Webhooks** — Real-time sync via webhooks instead of polling
- [ ] **Browser extension** — Triage sidebar on GitHub/GitLab issue pages
- [ ] **Mobile-friendly view** — Responsive triage for on-the-go processing

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
| `AUTH_SECRET` | Random secret for Auth.js session encryption |
| `AUTH_GITHUB_ID` | GitHub OAuth App client ID |
| `AUTH_GITHUB_SECRET` | GitHub OAuth App client secret |

Optional:

| Variable | Description | Default |
|----------|-------------|---------|
| `AUTH_URL` | Base URL for Auth.js callbacks | `http://localhost:3000` |
| `DATABASE_URL` | Postgres connection string | (uses SQLite) |
| `SQLITE_PATH` | SQLite database file path | `./data/snaptriage.db` |
| `AUTH_GITLAB_ID` | GitLab OAuth App ID | |
| `AUTH_GITLAB_SECRET` | GitLab OAuth App secret | |
| `AUTH_GITLAB_URL` | Self-hosted GitLab URL | `https://gitlab.com` |
| `SYNC_INTERVAL_MS` | Auto-sync interval | `300000` (5 min) |

</details>

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE)
