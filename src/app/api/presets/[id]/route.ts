export const dynamic = "force-dynamic";

/**
 * @module /api/presets/[id]
 *
 * Rename, re-describe, or remove one of the signed-in user's presets.
 *
 * Both handlers scope by `userId` in the query itself, so a preset belonging
 * to somebody else is reported as missing rather than forbidden: the caller
 * cannot learn that an id they guessed exists.
 *
 * - **Endpoint:** `/api/presets/:id`
 * - **HTTP Methods:** PATCH, DELETE
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  deletePreset,
  findOwnedRepo,
  findPresetRow,
  updatePreset,
} from "@/features/presets/preset-repository";
import { providerLimitViolation } from "@/features/presets/preset-actions";
import { updatePresetSchema, parseBody } from "@/lib/validations";

/**
 * Updates a preset's name, its actions, or both.
 *
 * @param req - Request with JSON body `{ name?, actions? }`.
 * @param params - Dynamic route params containing `id` (the preset's DB primary key).
 * @returns JSON preset, or an error with 400/401/404 status.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(updatePresetSchema, rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  // Changing the actions re-opens the question the create route settles: a
  // label that fits the schema's fixed bound may still be longer than this
  // repository's provider accepts. Checked before the write so an edit cannot
  // turn a working preset into one that never applies. A missing repository
  // cannot happen while the cascade holds, so it skips the check rather than
  // inventing a second not-found path.
  if (parsed.data.actions) {
    const row = await findPresetRow(session.user.id, id);
    if (!row) {
      return NextResponse.json({ error: "Preset not found" }, { status: 404 });
    }
    const repo = await findOwnedRepo(session.user.id, row.repoId);
    const rejected = repo && providerLimitViolation(repo.provider, parsed.data.actions);
    if (rejected) {
      return NextResponse.json({ error: rejected }, { status: 400 });
    }
  }

  const preset = await updatePreset(session.user.id, id, parsed.data);
  if (!preset) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }

  return NextResponse.json(preset);
}

/**
 * Deletes a preset.
 *
 * Deleting a preset does not revert earlier applications: those were triage
 * writes like any other, and the issue keeps whatever they committed.
 *
 * @param _req - Incoming request (unused).
 * @param params - Dynamic route params containing `id` (the preset's DB primary key).
 * @returns JSON `{ ok: true }`, or an error with 401/404 status.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const removed = await deletePreset(session.user.id, id);
  if (!removed) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
