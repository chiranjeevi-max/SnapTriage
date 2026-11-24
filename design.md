# Design: SnapTriage

Shared design reference for the utilitarian workbench redesign.

## System

- Genre: modern-minimal. Theme: SnapTriage brand.
- Shape: a keyboard queue beside a reading pane, within an adaptive shell.
- Tone: precise, calm, compact, with a clear working hierarchy.
- Preserve Geist Sans, Geist Mono, the SnapTriage mark, and semantic data colours.
- Keep the existing content, routes, forms, handlers, and keyboard registry.
- No photographs, gradients, invented metrics, decorative status dots, or loading reveals.

## Tokens

`src/app/tokens.css` is the source of truth. Reuse the existing shadcn role names.

- `--background`: quiet neutral workspace canvas.
- `--card`: reading and working surface.
- `--sidebar`: secondary navigation surface.
- `--foreground` and `--muted-foreground`: primary and supporting text.
- `--border`: structural hairlines.
- `--primary`: ink-filled primary action.
- `--selection-surface` and `--selection-rule`: current queue row.
- `--state-open`: meaningful issue state.
- `--font-geist-sans`: headings, sentences, labels, navigation, and controls.
- `--font-geist-mono`: repository slugs, IDs, keys, counts, and timestamps.
- Shared spacing and motion scales live beside the colour roles.

## Composition

- Desktop: compact sidebar, full-height queue, distinct reading surface. The toolbar is two stable rows: identity and surfaces above, narrowing controls below.
- Queue rows carry the title, priority, repository, number, author, and age. Labels belong to the reading pane, not the row.
- The description and discussion share one scrolling reading column; the reply composer stays pinned below it. Triage actions share one row: a priority select, Dismiss, Close, Wait, and a More menu for labels, assignees, snooze, and presets. The composer rests at one line and expands on focus, on typed text, or on a stored draft.
- Small screens: navigation becomes a horizontal bar and the inbox opens on the queue. Selecting a row, pressing Enter, or opening a follow-up shows the issue at full width and hides the queue toolbar so the reading column owns the screen; closing it returns to the queue.
- Repositories and settings: one capped content measure, section labels beside their controls.
- Public pages: same system, a product-led opening, solid surfaces, generous type.
- Hairlines separate rows. A panel frames a tool; avoid nested cards.
- Cap the shell at 1600px and centre it at larger widths.

## Controls and motion

- App controls: 32–40px; public primary actions: 44px. Coarse-pointer devices raise app controls to 44px.
- Controls use the shared radius and visible, instant focus outlines.
- Motion answers an action; respect reduced motion throughout.
- Use shared component wrappers. Never edit `src/components/ui/*` primitives.

## Exports

`src/app/tokens.css`, `src/app/base.css`, and `src/app/globals.css`.
