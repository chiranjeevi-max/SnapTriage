@AGENTS.md

# CLAUDE.md — SnapTriage (Claude-only)

Use `/init` output as draft only, keep this file as source of truth.
Run `/context` to confirm load, `/memory` to edit, `/clear` between tasks.
Prefer single-file test runs for speed; state done as `lint + typecheck + test` exit 0.
For procedures touching one area, check `.claude/rules/` or the nearest `AGENTS.md` first.
