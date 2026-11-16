export const dynamic = "force-dynamic";

/**
 * @module /api/follow-ups
 *
 * The follow-up queue: issues the user is explicitly waiting on.
 *
 * `GET` lists them with the reason each came back and when it was last checked.
 * `POST` runs one bounded check pass, which the inbox calls when it opens —
 * there is no background scheduler, so freshness is bounded by how recently the
 * user was here and the response says exactly when that was.
 *
 * - **Endpoint:** `/api/follow-ups`
 * - **HTTP Methods:** GET, POST
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { listFollowUps, runFollowUpCheck } from "@/features/follow-up/follow-up-service";

/**
 * Lists the user's followed issues.
 *
 * @returns JSON `{ entries, checkedAt }`; `checkedAt` is the newest check time
 *   among the entries, so the UI can state its freshness instead of implying
 *   the list is live.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entries = await listFollowUps(session.user.id);
  const newest = entries.reduce<string | null>((latest, entry) => {
    if (!entry.checkedAt) return latest;
    return !latest || entry.checkedAt > latest ? entry.checkedAt : latest;
  }, null);

  return NextResponse.json({ entries, checkedAt: newest });
}

/**
 * Runs one bounded check pass over the waiting issues.
 *
 * @returns JSON with how many issues were examined and how many surfaced.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const summary = await runFollowUpCheck(session.user.id);
  return NextResponse.json(summary);
}
