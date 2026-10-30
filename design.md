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

- Desktop: compact sidebar, full-height queue, distinct reading surface.
- Small screens: navigation becomes a horizontal bar; issue detail uses the available width.
- Repositories and settings: one capped content measure, section labels beside their controls.
- Public pages: same system, a product-led opening, solid surfaces, generous type.
- Hairlines separate rows. A panel frames a tool; avoid nested cards.
- Cap the shell at 1600px and centre it at larger widths.

## Controls and motion

- App controls: 32–40px; public primary actions: 44px.
- Controls use the shared radius and visible, instant focus outlines.
- Motion answers an action; respect reduced motion throughout.
- Use shared component wrappers. Never edit `src/components/ui/*` primitives.

## Exports

`src/app/tokens.css`, `src/app/base.css`, and `src/app/globals.css`.
