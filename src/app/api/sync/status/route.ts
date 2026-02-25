/**
 * @module /api/sync/status
 *
 * Returns the last-synced timestamp for each of the user's connected repos.
 * Used by the UI to display sync freshness indicators.
 *
 * - **Endpoint:** `/api/sync/status`
 * - **HTTP Methods:** GET
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { repos } from "@/lib/db/schema";

/**
 * Fetches sync status for all of the authenticated user's repos.
 *
 * @returns JSON array of `{ repoId, fullName, lastSyncedAt }` objects
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userRepos = await (db as any)
    .select({
      id: repos.id,
      fullName: repos.fullName,
      lastSyncedAt: repos.lastSyncedAt,
    })
    .from(repos)
    .where(eq(repos.userId, session.user.id));

  const statuses = userRepos.map(
    (r: { id: string; fullName: string; lastSyncedAt: Date | null }) => ({
      repoId: r.id,
      fullName: r.fullName,
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    })
  );

  return NextResponse.json(statuses);
}
