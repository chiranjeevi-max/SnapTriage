# Architecture & Technology Stack

SnapTriage is a keyboard-first issue triage tool. It aggregates issues, repositories, and labels from the GitHub and GitLab APIs.

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

SnapTriage connects to remote providers (GitHub and GitLab) to fetch issues, repositories, and labels. Since triage speed is critical, it uses optimistic UI updates.

There are two sync modes:

1. **Live Sync (Instant)**
   - Actions like labeling, dismissing, or prioritizing trigger an immediate API call to the provider.
   - The UI is optimistically updated. If the API call fails, the UI rolls back to the previous state.
2. **Batch Sync (Staged)**
   - Changes are collected locally in the client state.
   - They are pushed to the remote provider in bulk when the user explicitly hits the "Sync" shortcut.
   - Ideal for scenarios with rate limits or slow networks.

Webhook updates (optional): a GitHub or GitLab webhook calling `/api/webhooks/[provider]` syncs the matching connected repos immediately, on top of the polling interval. The shared secret travels in the provider's own header: `X-Hub-Signature-256` (HMAC-SHA256 over the raw body) for GitHub, `X-Gitlab-Token` for GitLab. It never travels in a query string that would land in access logs.

## Deployment Strategy

### Docker (Local & Self-Hosted)
- Uses SQLite by default, so it runs anywhere.
- The `Dockerfile` provides a standalone production build.
- Data is stored locally in the `data/` volume.

### Vercel (Serverless)
- Requires `Postgres` since SQLite is not compatible with stateless serverless functions.
- Neon is the recommended Postgres provider.

## Design Language

One vocabulary across the landing page, the sign-in page, and the app. It is
encoded in shared components so new surfaces inherit it instead of reinventing
it.

**Principles.**

- A surface inherits the language; it does not invent one. When something is
  missing, add it to the shared vocabulary rather than styling the page.
- The type split is semantic, not decorative: sans for human sentences, mono
  for machine data.
- Colour carries meaning, not mood. Neutral tokens hold all structure;
  saturated colour appears only where the data itself is coloured.
- Motion answers an action. Anything the reader can interrupt is a spring;
  everything else is a short transition, and both respect reduced motion.
- Density over decoration. Hairlines divide rows; boxes are for panels that
  genuinely frame a tool.

**Type.** Geist Sans for human sentences, Geist Mono for machine data (keys,
repo slugs, issue numbers, counts, times, sync stamps). Display sizes get
negative tracking, body copy stays at zero.

**Surfaces.** The page canvas is `bg-background`. The sidebar uses `--sidebar`; the reading pane and working controls use `bg-card`. Hairlines divide regions and rows. The selected issue uses `--selection-surface` and `--selection-rule`, so it remains distinct from pointer hover. Panels frame a tool rather than boxing each row.

**Colour.** Neutral tokens carry all structure. The only saturated colour is
real data: priority chips (`src/features/triage/priority.ts`), provider icons,
and meaningful issue state. Live and batch modes use named controls and icons.

**Controls.** Panels are `rounded-xl`, controls and chips `rounded-md`, pills
`rounded-full`. Heights: `h-9` for toolbar controls, `h-8` for dense actions,
`h-11` for large buttons.

The shared tokens live in `src/app/tokens.css`; `design.md` records the system.
The desktop shell is capped at 1600px. Below 960px navigation becomes a horizontal
bar. On phones the inbox shows the selected issue at full width; closing its
details returns to the queue. The issue heading scales with the reading pane
width. Virtualized rows keep an estimated height while their pane is hidden,
so showing the queue does not shift its scroll position. Long repository names
wrap on management screens.

**Shared pieces.**

| Piece | Purpose |
|---|---|
| `src/components/brand.tsx` | The wordmark, used on every public surface and in the app shell |
| `src/components/page-header.tsx` | Page title, description, and actions |
| `src/components/empty-state.tsx` | The one empty/error pattern, with a next step |
| `src/components/segmented-control.tsx` | Mutually exclusive choices (provider, theme, sync mode) |
| `src/components/select-field.tsx` | The styled native select the project has no primitive for |
| `src/features/keyboard/components/shortcut-list.tsx` | The shortcut registry rendered as a list |
| `src/features/triage/priority.ts` | Priority colours, names, and key hints |

**Motion.** Movement that the user can interrupt uses a spring
(`src/features/landing/spring.ts`) and writes transforms straight to the DOM.
State changes use short CSS transitions. `prefers-reduced-motion` snaps instead
of animating; `prefers-reduced-transparency` turns the translucent chrome
solid.

**Worst-case data.** Every layout in the app was tested against real provider
limits, not against kind demo data, and the harness for that ships with the
code. `?data=worst|empty|one|many` swaps the data at the query boundary, and a
chip in the bottom-right corner shows the active mode and expands into the
segmented control on hover or focus. The fixtures
(`src/features/dev-tools/fixtures.ts`) encode documented limits: a
256-character title, a 50-character label, a hundred labels on one issue, a
104-character repository slug, a Vietnamese and Thai title, a body at the
provider's size cap. The toggle renders only when `NODE_ENV` is `development`
and the fixture data is imported lazily, so a production build contains
neither. Add a fixture when you add a field to a row; the next person to change
that row will need it.

## Public Surface

- `/` is the public landing page. Signed-out visitors get it; signed-in users are redirected to `/inbox` so a self-hosted instance never makes them pass through a marketing page.
- The landing hero is a live demo of the inbox, not a screenshot. It is a client component under `src/features/landing/`, and it reuses the app's shortcut registry and priority colours so the page cannot advertise a binding or a colour the app does not have.
- Keyboard feedback on the landing page is driven by a small spring integrator (`src/features/landing/spring.ts`) that writes transforms straight to the DOM. It snaps instead of animating when the reader asks for reduced motion.

## Extensibility

- **Providers**: The `IssueProvider` interface abstracts provider logic, so adding integrations like Jira or Linear means implementing it.
- **Shortcuts**: A shared registry binds React components to key presses. The same registry renders the in-app `?` overlay and the landing page's keyboard map.
