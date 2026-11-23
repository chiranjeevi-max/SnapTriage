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

### Cycle 2 — Stamp the sync watermark when the read starts
`sync-engine.ts` wrote `lastSyncedAt = new Date()` *after* every upsert batch. Both
providers filter `since` / `updated_after` strictly, so an issue updated while the pages
were still arriving carried an `updated_at` earlier than the watermark and was never
fetched again — silent, permanent data loss, not a delay. Now stamped from the instant the
read began, minus a 60s margin so a provider clock running behind ours cannot hide a
boundary update either. Verified by reverting the fix: both new tests fail without it.

### Cycle 3 — Record the turn when a follow-up pass has no token
`checkOne` returned `null` on a missing token, and `runFollowUpCheck` counted that as
`skipped` without calling `markAttempted` — unlike the two sibling skip paths, which do it
because otherwise the same rows are re-selected every pass. With an undecryptable or absent
token the first 20 waiting rows occupied the batch forever and nothing behind them was ever
checked, so a bad token disabled follow-up entirely rather than merely staling it. The token
check moved into the loop beside the other skip paths, `checkOne` now takes a non-null token,
and three tests fail without the change.

### Cycle 4 — Treat an unparseable request body as a client error
`PATCH /api/issues/[id]` and `POST /api/views` read `await req.json()` unguarded while the
other eleven mutating routes all use `.catch(() => null)`. A truncated or absent body threw
`SyntaxError` out of the handler, surfacing as a 500 on the app's hottest write path. Both
now match the established convention and return 400; three tests fail without the change.

### Cycle 5 — Stop the issue filter widening to every repo
`GET /api/issues` treated an unrecognised `repoId` as "no filter" and fell through to
`inArray(issues.repoId, repoIds)`, returning the whole queue. A stale id therefore made the
repo selector look like it had silently stopped working, and after a disconnect the client
still holds the deleted id. A filter that cannot match now selects nothing; the test fails
against the old code with both repos' issues returned.

### Cycle 6 — Release provider request timers on every read path
Two adapter defects, both from the same rule stated in the modules' own comments: every
response body must be read through a helper that releases the request's abort timer.
`githubProvider.getRepoPermission` read `/user` with bare `res.json()`, leaking a timer and
interpolating a possibly-absent `login` into `/collaborators/undefined/permission` — whose
404 surfaced as "repository not found or not accessible" for a repo the user can see. The
GitLab adapter had no `readText` at all and its six `!res.ok` paths called `res.text()`
directly, leaking one 30s timer per failed call. Added `readText`, routed all six through
it. Four tests fail without the change.

### Cycle 7 — Make a failed sync always report itself
The `started` sync-log insert sat outside the `try`, and the `failed` insert inside the
`catch` was unguarded. When the database was the failing component, `syncRepo` rejected
instead of returning a `SyncResult` — and `POST /api/sync` calls it directly for one repo,
so the route answered a bare 500 with no outcome. The one path whose job is to record
failures could not report its own. Both writes are now inside the guarded region, and
`issuesFetched` counts post-dedup rows so the log line and the record agree.

### Cycle 8 — Validate the custom snooze date
The snooze picker called `new Date(customDate).toISOString()` on any non-empty
`datetime-local` value. `toISOString()` throws `RangeError` on an invalid date, inside a
React click handler; and a past date was accepted silently, storing a snooze that had
already expired so the issue read as not snoozed the instant it was set. Extracted the
date rules into `triage/snooze.ts` (the codebase's stated pattern for testable logic),
added a `min` bound to the input, and refuse rather than convert anything that is not a
future instant.

### Cycle 9 — Bound the follow-up review baseline
`PUT /api/issues/[id]/follow-up?action=review&commentAt=<any date>` validated only that the
date parsed, then stored it as `lastSeenCommentAt`. Detection asks whether a comment is at
or after that baseline, so a future instant matched nothing and the issue could never
resurface — a review that silently disabled the watch for good, reachable by any signed-in
user. Rejected beyond a 60s clock-skew allowance, which still accepts an honest review whose
instant leads ours by a few seconds.

### Cycle 10 — Report 404 when a destructive route touches nothing
`DELETE /api/views/[id]`, `DELETE /api/repos/[id]` and `PATCH /api/repos/[id]` answered
`{ ok: true }` unconditionally. A stale id therefore reported a deletion that never
happened, and the client kept showing a row the server had never removed. They now return
404 through `.returning()`, matching the pattern `saved-replies/[id]` already used;
`disconnectRepo`/`updateRepo` return whether a row matched. Five tests fail without it.
