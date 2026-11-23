# Overnight Autonomous Improvements

## Morning summary

Branch `overnight-auto-improvements`, 29 commits, working tree clean. Nothing is pushed and
nothing was reverted — no cycle was abandoned; each was fixed until the gate passed.

**Final state:** lint clean, typecheck clean, `format:check` clean, `next build` succeeds,
878 unit tests pass (753 at baseline, +125). All commits are GPG-signed with `-s`; no signing
fallback was needed.

**The five defects worth knowing about:**

1. **SQLite foreign keys were never enabled.** Every `onDelete: cascade` was inert on the
   default deployment, so disconnecting a repo orphaned its issues, drafts, presets and sync
   log — violating the invariant `AGENTS.md` says to rely on.
2. **The sync watermark was stamped after the fetch**, so an issue updated while pages were
   still arriving was never fetched again. Silent, permanent data loss.
3. **A batch push wiped changes staged during its provider call** — never sent, never
   retried, because the flag was cleared too.
4. **Follow-up ordering was driver-dependent.** It relied on NULL sorting first, which is
   true on SQLite and false on Postgres, so on Neon a newly armed follow-up was never
   reached.
5. **GitHub triage writes sent no `Content-Type`.** `fetch` stamped `text/plain`, which
   GitHub does not parse as JSON — and `DELETE /assignees` ignored the body, unassigning
   everyone rather than the named user.

Also fixed: provider abort timers leaking on six GitLab paths plus GitHub's permission
lookup and every accepted `updateIssue`; malformed request bodies returning 500 on the two
hottest routes; an unknown `repoId` widening to the whole queue; a failed sync rejecting
instead of reporting; two missing 404s on destructive routes; an unvalidated snooze date
throwing inside a click handler; an unbounded follow-up baseline that disabled resurfacing;
and a webhook subscriber cap that reported success while skipping subscribers.

**Five additive features**, each its own commit and revertable with `git revert`:
close/reopen from the keyboard (`c`), an inbox search bar (`label:bug`, `author:x`, `#123`),
queue sort order, keyboard bulk selection (`x` / `Shift+X`), and a preview of what a batch
push will send.

**Two things I introduced and then fixed**, both caught by a self-audit rather than by tests:
a Zustand write during render in the bulk-selection feature, and a hydration mismatch in the
storage hooks.

Nothing was abandoned as a failed attempt. Two items were deliberately not pursued: the
architecture doc's deferred items and the untested status of `githubProvider.fetchLabels` /
`fetchCollaborators`, which are lower-value than the five defects above and would each have
needed a larger test surface than one cycle allows.

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

`sync-engine.ts` wrote `lastSyncedAt = new Date()` _after_ every upsert batch. Both
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

### Cycle 11 — Do not fail after the provider accepted the write

`applyTriage` committed the provider change, then ran two unguarded local writes. A failure
in either — `ensureTriageRow` throwing "Failed to get triage state", or a locked database —
escaped through the PATCH route as a 500, and the client rolled its optimistic update back
to values upstream no longer held. The cached issue row now writes first (it mirrors what
the provider just did, so a later failure cannot leave the cache disagreeing with upstream),
both writes are guarded, and the failure returns a distinguishable 502.

### Cycle 12 — Treat an unreachable provider as unreachable

The comments route handled `ProviderApiError` and rethrew everything else, so a plain
`fetch` rejection — DNS failure, reset socket, a self-hosted GitLab that is down — surfaced
as a 500. That is the same "provider is unreachable" condition as the branch above it and
now returns the same 502, which the UI already knows how to present.

### Cycle 13 — Bound the repo browser's body read

`fetch-available-repos.ts` (no tests at all) cleared its abort timer in a `finally` the
moment `fetch` resolved, leaving `res.json()` with no deadline — the exact defect the GitLab
adapter's docblock documents as already fixed there. A provider that sent headers then
stalled held the request open forever. Also crashed the whole page on a project with a null
`namespace`, dropping every page already read, and leaked a timer on error responses. Timer
release moved to a body-read helper; owner falls back to the full path.

### Cycle 14 — Surface the webhook subscriber cap

The webhook route synced at most 50 subscribers per delivery and then answered
`{ ok: true, synced: 50 }`. For a repository popular enough to exceed the cap — the exact
case multi-tenant tracking produces — the last subscribers were never synced and nothing
said so. The cap stays (it bounds one request's fan-out) but now fetches one row past it to
detect truncation, logs, and answers 503 with the delivery kept retryable.

## Features

The bug backlog is now down to lower-severity items. These five are additive, self-contained,
and each is its own commit so it can be reverted with `git revert`.

### Feature 1 — Close or reopen the issue from the keyboard

Justification: the close/reopen path already exists end to end — the patch schema accepts
`state`, `applyTriage` passes it to the provider, both clients implement it, and the
optimistic updater applies it — but nothing ever sends it, so a maintainer cannot finish an
issue without leaving the app.

### Feature 2 — Inbox query bar

Justification: with a large queue the only way to reach a known issue is `j` one row at a
time; there is no text search anywhere in the app. A tokenized query over the fields already
on the queue payload is pure client logic and needs no schema or API change.

### Feature 3 — Queue sort order

Justification: the API hardcodes `updatedAt` descending, so the ordering a maintainer
actually wants — oldest untouched first, or untriaged to the top — is unreachable. The whole
list is already client-side, so this is a pure comparator plus one control.

### Feature 4 — Keyboard bulk selection

Justification: bulk triage works but selection is checkbox-only, which undercuts the
"keyboard-driven inbox" premise — the one workflow that saves the most time is the one that
needs a mouse. Two keys and a pure reducer, no schema or API change.

### Feature 5 — Staged-push preview

Justification: the batch bar says "3 pending changes" and offers Push but never says what
will be pushed, so the app's most irreversible provider write is the one the user cannot
inspect. The staged diffs already travel on the queue payload, so this is a pure fold plus a
list.

## Additional cycles (post-audit)

### Cycle 15 — Declare JSON on GitHub writes and free their timers

`githubProvider.updateIssue` had no test and two latent defects: no request declared
`Content-Type: application/json` (so `fetch` stamped `text/plain`, which GitHub does not
parse — and the `DELETE /assignees` body was ignored outright, unassigning everyone), and
`checked()` returned successful responses without reading or releasing them, leaking one
abort timer per accepted write. Both fixed; 8 tests added, 5 of which fail against the old
code.

### Cycle 16 — Order follow-ups portably by attempt

The check pass ordered by `followUps.attemptedAt` and its comment claimed NULL sorts first
on both drivers. That is true for SQLite only; Postgres sorts NULL **last** on an ascending
`ORDER BY`. On Neon a freshly armed follow-up landed behind twenty already-attempted rows,
which refilled the batch every pass — the exact starvation `attemptedAt` exists to prevent.
Now `coalesce(attemptedAt, 0)`; added a real-database test that also documents why SQLite
never showed the bug.

### Cycle 17 — Keep changes staged during a batch push

`pushBatchChanges` read the staged diffs, spent up to the request timeout on the provider
call, then cleared unconditionally. Anything staged in that window was wiped to `{}` with
`batchPending` cleared — never sent, never retried. The clear is now conditional on the
revision read at the start of the pass; a row that changed hands keeps its flag and the
next push sends the newer values.

### Cycle 18 — Pass selection callbacks instead of a store round trip

I introduced this in Feature 4: the inbox wrote to the Zustand store during render, which
React rejects (it is an external-store mutation, not a state update). Replaced the store
round trip with callbacks passed straight to the keyboard dispatcher.

### Cycle 19 — Count pending batch changes in the database

`GET /api/batch/pending-count` selected every column of every pending row — including each
issue's whole `pendingChanges` JSON blob — to return `.length`, polled every 30s per tab.
Now a `count()` aggregate, matching `saved-replies`.

### Cycle 20 — Read persisted inbox state without a hydration mismatch

`useIssueFilter` (pre-existing) and the two hooks I added read `localStorage` in a `useState`
initializer, which runs on the server too, so server and client renders disagreed and React
discarded the tree. Rewritten onto `useSyncExternalStore` with a server snapshot, shared by
all three. A failed write still applies for the session rather than reverting under the user.

### Cycle 21 — Subscribe to the keyboard store with selectors

Two selectorless `useKeyboardStore()` calls re-rendered the whole inbox — four list memos and
the virtualizer — on every store field, including ones it never reads, on every `j`/`k`.
Split into individual selectors.

### Cycle 22 — Report token validation faults as 502

`POST /api/auth/token` answered 401 "Invalid token" for every failure, including a provider
outage or a fault in the rate-limit store — telling the user their credential was bad when
it might be fine, and leaving an operator no trace. Now 401 only for `InvalidTokenError`
(provider rejection), 502 and a log line otherwise.

### Cycle 23 — Make repeated query terms intersect

Two nits in my own Feature 2 code: repeated issue numbers were an OR while every other field
was an AND, so `#1 #2` was the only term that could widen; and the free-text haystack was
rebuilt inside the term loop for every row.

### Cycle 24 — Cover labels and collaborators

The two gaps I had deferred. `fetchLabels` and `fetchCollaborators` on both adapters back the
label and assignee pickers that open on every triage action, and neither had a test; the two
routes serving them had none either.

24 tests added. The assertions that matter: `role_name` and GitLab access levels must map to
the same permission scale `getRepoPermission` uses, or the picker offers someone as a
maintainer who cannot write; GitLab label colours must have their leading `#` stripped, or
the swatch is an invalid CSS colour on one provider only; and a failed page must release its
abort timer, since this is the most-travelled path in the app.

All were mutation-tested rather than assumed: dropping the `#` strip, dropping the
`maintain → write` mapping, restoring a `discard()` leak, and removing the route's ownership
guard each made a test fail.

One finding recorded rather than fixed: both routes answer `200 []` for a provider failure as
well as for a genuinely empty result, so the picker cannot tell "this repo has no labels" from
"your token expired". Neither picker reads `isError` today, so an error status would render a
blank list rather than an explanation — the ambiguity is captured in a test so changing it
later is a deliberate decision.
