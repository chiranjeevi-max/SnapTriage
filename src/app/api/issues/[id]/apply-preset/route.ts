export const dynamic = "force-dynamic";

/**
 * @module /api/issues/[id]/apply-preset
 *
 * Applies one stored preset to one issue.
 *
 * The request names a preset; it never carries the actions. Everything the
 * write depends on — the issue, its repository, the preset, the triage row the
 * preview was computed against, and the effective sync mode — is re-read here,
 * so a client cannot apply a bundle the server never validated, and a preset
 * that changed since the preview is applied on the terms stored now.
 *
 * The diff comes from `resolvePreset`, the same pure function the pane
 * previews with, so the toast cannot advertise a change the write does not
 * make. A resolution that changes nothing returns immediately: no provider
 * call and no `triage_state` write, because an idempotent re-apply must not
 * spend a provider request or manufacture a row to undo.
 *
 * - **Endpoint:** `/api/issues/:id/apply-preset`
 * - **HTTP Methods:** POST
 * - **Auth:** Required (session-based); issue and preset must both belong to the user
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { findPresetRow, toPreset } from "@/features/presets/preset-repository";
import { effectiveTriageState, resolvePreset } from "@/features/presets/types";
import type { PendingChanges } from "@/features/triage/types";
import {
  applyTriage,
  loadTriageContext,
  resolveTriageMode,
} from "@/features/triage/triage-service";
import { applyPresetSchema, parseBody } from "@/lib/validations";

/**
 * Resolves a preset against one issue and applies the resulting diff.
 *
 * @param req - Request with JSON body `{ presetId, batch? }`.
 * @param params - Dynamic route params containing `id` (the issue's DB primary key).
 * @returns JSON `{ ok, mode, noChange, applied, changes }`, or an error with
 *   400/401/403/404/422/502 status.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.id;
  const { id } = await params;

  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(applyPresetSchema, rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { presetId, batch } = parsed.data;

  const context = await loadTriageContext(userId, id);
  if (!context) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }
  const { issue, repo, triage } = context;

  const row = await findPresetRow(userId, presetId);
  if (!row) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }

  // A preset is scoped to the repository it was saved for. Consulting it from
  // another repository would apply label names and logins that repository may
  // not have, so the mismatch is reported as a missing preset.
  if (row.repoId !== issue.repoId) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }

  const preset = toPreset(row);
  if (!preset) {
    return NextResponse.json(
      { error: "This preset is no longer valid. Edit and save it again to apply it." },
      { status: 422 }
    );
  }

  const mode = resolveTriageMode(repo.syncMode, batch);
  // A batch repository keeps provider values in two places: the cached issue row
  // and the staged diff. Resolving against the row alone reports a preset as a
  // no-op whenever a staged change contradicts it, and the push then applies that
  // staged change instead of the preset.
  const staged = (triage?.pendingChanges ?? null) as PendingChanges | null;
  const effective = mode === "batch" ? effectiveTriageState(issue, staged) : issue;

  const resolution = resolvePreset(preset.actions, {
    labels: effective.labels ?? [],
    assignees: effective.assignees ?? [],
    triage: triage ? { priority: triage.priority } : null,
  });

  if (resolution.noChange) {
    return NextResponse.json({ ok: true, mode, noChange: true, applied: {}, changes: [] });
  }

  const result = await applyTriage({ userId, issueId: id, payload: resolution.payload, batch });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    mode: result.mode,
    noChange: false,
    applied: result.applied,
    changes: resolution.changes,
  });
}
