# Overnight Autonomous Improvements

Branch: `overnight-auto-improvements`
Baseline: lint clean, typecheck clean, 753 unit tests passing.

## Cycles

### Cycle 1 — Enable SQLite foreign keys
`src/lib/db/index.ts` opens better-sqlite3 without `PRAGMA foreign_keys = ON`, so SQLite's
default (OFF) applies. Every `onDelete: cascade` in the schema is inert on the default
SQLite deployment: disconnecting a repo orphans its issues, triage_state, reply_draft,
follow_up, triage_preset and sync_log rows. AGENTS.md invariant 3 says cascade deletes are
assumed, so this is a direct invariant violation — and it produces duplicate/orphan data
that a later reconnect surfaces as phantom presets.
