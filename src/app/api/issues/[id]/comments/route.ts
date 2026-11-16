export const dynamic = "force-dynamic";

/**
 * @module /api/issues/[id]/comments
 *
 * Reads one page of an issue's discussion.
 *
 * Discussion is fetched per issue and on demand, never with the queue: a thread
 * is larger than the queue row that leads to it, and paying for it on every poll
 * would undo the split that keeps `GET /api/issues` small.
 *
 * Pagination is a cursor, not a page number, because the two providers page in
 * opposite directions. The adapter normalises both to "oldest first within the
 * page, cursor walks older", so this route never branches on the provider.
 *
 * A provider that does not implement comments is reported as `supported: false`
 * rather than as an empty thread — the difference between "nobody has replied"
 * and "we cannot tell" matters to someone deciding whether to wait for a reply.
 *
 * - **Endpoint:** `/api/issues/:id/comments`
 * - **HTTP Methods:** GET
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { loadReplyTarget } from "@/features/replies/reply-service";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import { ProviderApiError } from "@/lib/provider-error";
import { apiLogger } from "@/lib/logger";

/** Page size for the discussion pane; matches the provider's own default. */
const DEFAULT_PAGE_SIZE = 30;

/** Upper bound a caller may request. */
const MAX_PAGE_SIZE = 100;

/**
 * Returns one page of comments for the issue.
 *
 * @param req - Request whose query params are `cursor` and `limit`.
 * @param params - Dynamic route params containing `id`.
 * @returns JSON `{ comments, olderCursor, supported }`, or an error.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const target = await loadReplyTarget(session.user.id, id);
  if (!target) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const provider = getProvider(target.provider);
  if (!provider.fetchComments) {
    return NextResponse.json({ comments: [], olderCursor: null, supported: false });
  }

  const token = await getProviderToken(session.user.id, target.provider);
  if (!token) {
    return NextResponse.json({ error: "No provider token available" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const cursor = searchParams.get("cursor");
  const requested = Number(searchParams.get("limit") ?? DEFAULT_PAGE_SIZE);
  const limit = Number.isFinite(requested)
    ? Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;

  try {
    const page = await provider.fetchComments(target.owner, target.name, target.number, token, {
      cursor,
      limit,
    });

    return NextResponse.json({
      comments: page.comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        author: comment.author,
        authorAvatar: comment.authorAvatar,
        createdAt: comment.createdAt.toISOString(),
        updatedAt: comment.updatedAt.toISOString(),
        isSystem: comment.isSystem,
        url: comment.url,
      })),
      olderCursor: page.olderCursor,
      supported: true,
    });
  } catch (error) {
    if (error instanceof ProviderApiError && error.status === 400) {
      // The adapters reject a cursor they cannot parse with a 400 of their own
      // construction. That is the request's mistake, not the provider's, so it
      // must not be reported as an upstream failure.
      return NextResponse.json({ error: "Invalid comment cursor" }, { status: 400 });
    }

    if (error instanceof ProviderApiError) {
      apiLogger.warn(
        { issueId: id, provider: target.provider, status: error.status },
        "Comment fetch failed"
      );
      return NextResponse.json(
        { error: "Could not load this discussion right now." },
        { status: error.isAuthError ? 403 : 502 }
      );
    }
    throw error;
  }
}
