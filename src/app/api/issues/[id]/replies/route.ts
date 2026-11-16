export const dynamic = "force-dynamic";

/**
 * @module /api/issues/[id]/replies
 *
 * Publishes a reply to an issue as an ordinary comment.
 *
 * This is the only endpoint in the app that creates something a third party can
 * see, and it is not retryable by construction: neither provider's comment API
 * accepts an idempotency key, so a request that times out may or may not have
 * posted. A second POST therefore never happens automatically; a definitive
 * provider rejection clears the attempt so the draft can be edited and sent
 * again, and anything ambiguous leaves the draft unconfirmed with Send withheld.
 *
 * The body is re-validated against the repository's provider limit here rather
 * than in the schema, because the schema runs before the repository is known and
 * GitHub's limit is fifteen times smaller than GitLab's.
 *
 * - **Endpoint:** `/api/issues/:id/replies`
 * - **HTTP Methods:** POST
 * - **Auth:** Required (session-based); the issue must belong to the user's repo
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadReplyTarget, sendReply } from "@/features/replies/reply-service";
import { sendReplySchema, parseBody } from "@/lib/validations";

/**
 * Posts the supplied text as a comment on the issue.
 *
 * @param req - Request with JSON body `{ body }`.
 * @param params - Dynamic route params containing `id` (the issue's DB primary key).
 * @returns JSON with the created comment, or an error with 400/401/403/404/409/501/502.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(sendReplySchema, rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const target = await loadReplyTarget(session.user.id, id);
  if (!target) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const result = await sendReply(
    session.user.id,
    target,
    parsed.data.body,
    parsed.data.expectedVersion ?? null
  );
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.unconfirmed ? { unconfirmed: true } : {}) },
      { status: result.status }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      comment: {
        id: result.comment.id,
        body: result.comment.body,
        author: result.comment.author,
        authorAvatar: result.comment.authorAvatar,
        createdAt: result.comment.createdAt.toISOString(),
        updatedAt: result.comment.updatedAt.toISOString(),
        isSystem: result.comment.isSystem,
        url: result.comment.url,
      },
    },
    { status: 201 }
  );
}
