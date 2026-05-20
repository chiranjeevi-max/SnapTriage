# Architecture & Technology Stack

SnapTriage is designed to be a keyboard-first, highly responsive issue triaging tool. It acts as an aggregator over GitHub and GitLab APIs.

## Core Stack

- **Framework**: Next.js 16 (App Router) with TypeScript
- **Styling**: Tailwind CSS v4 & shadcn/ui
- **State Management**:
  - Server State: TanStack Query (React Query)
  - Client State: Zustand
- **Database**:
  - Local/Self-Hosted: SQLite
  - Serverless/Vercel: Postgres via Drizzle ORM
- **Authentication**: Auth.js (NextAuth v5) supporting OAuth and Personal Access Tokens (PAT).

## Data Flow & Sync Modes

SnapTriage connects to remote providers (GitHub and GitLab) to fetch issues, repositories, and labels. Since triage speed is critical, it heavily utilizes optimistic UI updates.

There are two primary synchronization modes:

1. **Live Sync (Instant)**
   - Actions like labeling, dismissing, or prioritizing trigger an immediate API call to the provider.
   - The UI is optimistically updated. If the API call fails, the UI rolls back to the previous state.
2. **Batch Sync (Staged)**
   - Changes are collected locally in the client state.
   - They are pushed to the remote provider in bulk when the user explicitly hits the "Sync" shortcut.
   - Ideal for scenarios with rate limits or slow networks.

## Deployment Strategy

### Docker (Local & Self-Hosted)
- Uses `SQLite` by default, making it simple to run anywhere.
- The `Dockerfile` provides a standalone production build.
- Data is stored locally in the `data/` volume.

### Vercel (Serverless)
- Requires `Postgres` since SQLite is not compatible with stateless serverless functions.
- Neon is the recommended Postgres provider.

## Extensibility

- **Providers**: The architecture abstracts the underlying provider logic, making it easy to add future integrations like Jira or Linear.
- **Shortcuts**: Managed via a global Shortcut Registry that binds React components to key presses.
