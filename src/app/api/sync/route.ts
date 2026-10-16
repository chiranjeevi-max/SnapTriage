export const dynamic = "force-dynamic";

/**
 * @module /api/sync
 *
 * Triggers an on-demand sync of issues from the upstream provider(s).
 * Can sync a single repo or all of the user's connected repos.
 *
 * - **Endpoint:** `/api/sync`
 * - **HTTP Methods:** POST
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncRepo, syncAllRepos } from "@/features/sync/sync-engine";
import { syncTriggerSchema, parseBody } from "@/lib/validations";

/**
 * Initiates a sync operation. If `repoId` is provided in the request body,
 * only that repo is synced; otherwise all connected repos are synced.
 *
 * @param req - Request with optional JSON body `{ repoId?: string }`
 * @returns JSON result from the sync engine (single result or array of results)
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => ({}));
  const parsed = parseBody(syncTriggerSchema, rawBody === null ? {} : rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { repoId } = parsed.data;

  if (repoId) {
    const result = await syncRepo(repoId, session.user.id);
    return NextResponse.json(result);
  }

  const results = await syncAllRepos(session.user.id);
  return NextResponse.json(results);
}
