export const dynamic = "force-dynamic";

/**
 * @module /api/issues/[id]/draft
 *
 * The reply draft for one issue.
 *
 * A draft is per user and per issue, saved on the server so it survives a
 * reload, a different tab, and a crash. `PUT` is conditional on the version the
 * editor last read, which is what stops two tabs from overwriting each other's
 * text: the stale writer gets a 409 and reloads instead of losing work.
 *
 * `DELETE` is offered because discarding a draft is a normal thing to want, and
 * leaving it behind would resurrect half-written text the next time the issue is
 * opened.
 *
 * - **Endpoint:** `/api/issues/:id/draft`
 * - **HTTP Methods:** GET, PUT, DELETE
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  clearDraft,
  findDraft,
  loadReplyTarget,
  saveDraft,
} from "@/features/replies/reply-service";
import { saveDraftSchema, parseBody } from "@/lib/validations";

/**
 * Returns the user's draft for the issue, or `null` when there is none.
 *
 * @param _req - Incoming request (unused).
 * @param params - Dynamic route params containing `id`.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const target = await loadReplyTarget(session.user.id, id);
  if (!target) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  return NextResponse.json(await findDraft(session.user.id, id));
}

/**
 * Creates or replaces the draft.
 *
 * @param req - Request with JSON body `{ body, expectedVersion }`.
 * @param params - Dynamic route params containing `id`.
 * @returns The saved draft, or 409 when another writer got there first.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(saveDraftSchema, rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const target = await loadReplyTarget(session.user.id, id);
  if (!target) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const result = await saveDraft(
    session.user.id,
    id,
    parsed.data.body,
    parsed.data.expectedVersion
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.draft);
}

/**
 * Discards the draft.
 *
 * @param _req - Incoming request (unused).
 * @param params - Dynamic route params containing `id`.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const target = await loadReplyTarget(session.user.id, id);
  if (!target) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  await clearDraft(session.user.id, id);
  return NextResponse.json({ ok: true });
}
