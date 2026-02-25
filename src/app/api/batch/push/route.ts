/**
 * @module /api/batch/push
 *
 * Pushes all pending batch triage changes to the upstream provider(s).
 * This flushes any staged label, assignee, and state changes that were
 * accumulated while repos were in batch sync mode.
 *
 * - **Endpoint:** `/api/batch/push`
 * - **HTTP Methods:** POST
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pushBatchChanges } from "@/features/sync/sync-engine";

/**
 * Triggers a push of all pending batch changes for the authenticated user.
 *
 * @returns JSON result object from the sync engine with per-issue outcomes
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await pushBatchChanges(session.user.id);
  return NextResponse.json(result);
}
