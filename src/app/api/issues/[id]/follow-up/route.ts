export const dynamic = "force-dynamic";

/**
 * @module /api/issues/[id]/follow-up
 *
 * Arms, reviews, or stops a follow-up on one issue.
 *
 * Three explicit transitions rather than an on/off flag, because they mean
 * different things: `wait` records a baseline and starts watching, `review`
 * acknowledges what came back and moves that baseline forward, and `stop`
 * abandons tracking without pretending it was dealt with.
 *
 * This is kept off `PATCH /api/issues/[id]` deliberately. That route is the
 * triage write path, and a follow-up is not a triage decision — folding it in
 * would make an unrelated retry of a label change able to re-arm a watch.
 *
 * - **Endpoint:** `/api/issues/:id/follow-up`
 * - **HTTP Methods:** PUT, DELETE
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { armFollowUp, reviewFollowUp, stopFollowUp } from "@/features/follow-up/follow-up-service";
import { followUpActionSchema, parseBody } from "@/lib/validations";
import { checkPersistentRateLimit } from "@/lib/rate-limit";

/**
 * Arms allowed per user per window.
 *
 * Only arming reads the provider (one comment page for the baseline); review
 * and stop are local writes and are deliberately not limited. Thirty in fifteen
 * minutes is well above a triage session and still bounds a loop.
 */
const ARM_LIMIT = 30;
const ARM_WINDOW_MS = 15 * 60 * 1000;

/**
 * Applies one follow-up transition.
 *
 * `review` accepts the comment that prompted it as an optional pair of query
 * params (`commentId`, `commentAt`). Omitting them reviews "everything up to
 * now": the baseline moves to the review instant, so the same comment cannot
 * raise the issue again on the next pass.
 *
 * @param req - Request with JSON body `{ action }` and optional review params in the URL.
 * @param params - Dynamic route params containing `id`.
 */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(followUpActionSchema, rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  if (parsed.data.action === "wait") {
    // Arming reads the provider to take a baseline, so it is the only transition
    // here that spends the user's quota or can be amplified against the provider.
    if (
      await checkPersistentRateLimit(
        `provider:follow-up:${session.user.id}`,
        ARM_LIMIT,
        ARM_WINDOW_MS
      )
    ) {
      return NextResponse.json(
        { error: "Too many follow-ups started. Try again shortly." },
        { status: 429 }
      );
    }

    const entry = await armFollowUp(session.user.id, id);
    if (!entry) {
      return NextResponse.json({ error: "Issue not found" }, { status: 404 });
    }
    return NextResponse.json(entry);
  }

  if (parsed.data.action === "review") {
    const { searchParams } = new URL(req.url);
    const commentId = searchParams.get("commentId");
    const rawAt = searchParams.get("commentAt");
    // `has` rather than a truthiness test: `?commentAt=` arrives as an empty
    // string, and treating that as "omitted" silently records a review with no
    // baseline, which widens the window instead of narrowing it.
    const commentAt = searchParams.has("commentAt") ? new Date(rawAt ?? "") : null;

    if (commentAt !== null && Number.isNaN(commentAt.getTime())) {
      return NextResponse.json({ error: "commentAt is not a valid date" }, { status: 400 });
    }

    const reviewed = await reviewFollowUp(session.user.id, id, commentId, commentAt);
    if (!reviewed) {
      return NextResponse.json({ error: "This issue is not being followed" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  }

  const stopped = await stopFollowUp(session.user.id, id);
  if (!stopped) {
    return NextResponse.json({ error: "This issue is not being followed" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}

/**
 * Stops tracking, as a single call for a client that only has the issue.
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
  const stopped = await stopFollowUp(session.user.id, id);
  if (!stopped) {
    return NextResponse.json({ error: "This issue is not being followed" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
