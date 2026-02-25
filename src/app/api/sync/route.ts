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

  const body = await req.json().catch(() => ({}));
  const { repoId } = body as { repoId?: string };

  if (repoId) {
    const result = await syncRepo(repoId, session.user.id);
    return NextResponse.json(result);
  }

  const results = await syncAllRepos(session.user.id);
  return NextResponse.json(results);
}
