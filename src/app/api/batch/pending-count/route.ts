export const dynamic = "force-dynamic";

/**
 * @module /api/batch/pending-count
 *
 * Returns the number of issues with unsent batch triage changes
 * for the authenticated user. Used by the UI to show a pending badge.
 *
 * - **Endpoint:** `/api/batch/pending-count`
 * - **HTTP Methods:** GET
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { eq, and, count } from "drizzle-orm";
import { auth } from "@/auth";
import { typedDb } from "@/lib/db/query";
import { triageState } from "@/lib/db/schema";

/**
 * Counts triage rows where `batchPending` is true for the current user.
 *
 * Counting in the database rather than reading the rows and taking their length:
 * the client polls this every 30 seconds, and every row carries its whole
 * `pendingChanges` JSON blob, so the old version transferred a user's entire
 * staged diff to display one integer.
 *
 * @returns JSON `{ count: number }` representing the number of pending batch items
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [row] = await typedDb
    .select({ total: count() })
    .from(triageState)
    .where(and(eq(triageState.userId, session.user.id), eq(triageState.batchPending, true)));

  return NextResponse.json({ count: row.total });
}
