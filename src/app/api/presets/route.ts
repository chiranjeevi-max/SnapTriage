export const dynamic = "force-dynamic";

/**
 * @module /api/presets
 *
 * The signed-in user's personal triage presets, one repository at a time.
 *
 * A preset is a stored *decision* — the labels, assignees, and personal
 * priority a maintainer reaches for when a familiar kind of issue arrives —
 * and it is only ever read because somebody asked for it by name. Nothing here
 * applies a preset; that is `POST /api/issues/[id]/apply-preset`, which
 * re-derives everything from the database rather than trusting this list.
 *
 * - **Endpoint:** `/api/presets`
 * - **HTTP Methods:** GET, POST
 * - **Auth:** Required (session-based); every row is scoped by `userId`
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  countPresets,
  createPreset,
  findOwnedRepo,
  listPresets,
} from "@/features/presets/preset-repository";
import { PRESET_LIMIT_PER_REPO } from "@/features/presets/types";
import { providerLimitViolation } from "@/features/presets/preset-actions";
import { createPresetSchema, parseBody } from "@/lib/validations";

/**
 * Lists the current user's presets for one repository.
 *
 * Stored `actions` are re-validated on the way out. A row that no longer
 * validates is omitted rather than returned half-parsed, so one stale row
 * cannot break the picker that renders the rest.
 *
 * @param req - Request whose `repoId` query param names the repository.
 * @returns JSON array of {@link Preset}, or an error with 400/401/404 status.
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repoId = new URL(req.url).searchParams.get("repoId");
  if (!repoId) {
    return NextResponse.json({ error: "repoId is required" }, { status: 400 });
  }

  const repo = await findOwnedRepo(session.user.id, repoId);
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  const presets = await listPresets(session.user.id, repoId);
  return NextResponse.json(presets);
}

/**
 * Creates a preset for one of the user's repositories.
 *
 * The repository is verified to belong to the caller before anything is
 * stored, and the per-repository quota is enforced here rather than by
 * truncating a list: a user who hits the limit is told so, and the presets
 * they already have keep working.
 *
 * The quota failure is **409**, not 422. The request is well-formed — a valid
 * name and valid actions — and would succeed against a repository with room,
 * so what it conflicts with is current state, not the schema. 422 is reserved
 * in this feature for a stored preset whose actions no longer validate, which
 * is a different problem with a different fix.
 *
 * @param req - Request with JSON body `{ repoId, name, actions }`.
 * @returns JSON preset with 201 status, or an error with 400/401/404/409 status.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(createPresetSchema, rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { repoId, name, actions } = parsed.data;

  const repo = await findOwnedRepo(session.user.id, repoId);
  if (!repo) {
    return NextResponse.json({ error: "Repository not found" }, { status: 404 });
  }

  // The schema validates against a generous fixed limit, but the repository's
  // provider has its own. Saving a label GitHub will never accept would produce
  // a preset that cannot be applied and cannot be fixed except by editing it,
  // so the mismatch is reported now, while the user is looking at the editor.
  const rejected = providerLimitViolation(repo.provider, actions);
  if (rejected) {
    return NextResponse.json({ error: rejected }, { status: 400 });
  }

  const existing = await countPresets(session.user.id, repoId);
  if (existing >= PRESET_LIMIT_PER_REPO) {
    return NextResponse.json(
      {
        error: `This repository already has ${PRESET_LIMIT_PER_REPO} presets, the maximum allowed. Delete one to save another.`,
      },
      { status: 409 }
    );
  }

  const preset = await createPreset({ userId: session.user.id, repoId, name, actions });
  return NextResponse.json(preset, { status: 201 });
}
