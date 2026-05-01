export const dynamic = "force-dynamic";

/**
 * @module /api/issues
 *
 * Lists issues for the authenticated user, with optional repo and state filters.
 * Each issue is returned with its associated triage state (priority, snooze, dismissed).
 *
 * - **Endpoint:** `/api/issues`
 * - **HTTP Methods:** GET
 * - **Auth:** Required (session-based)
 * - **Query params:**
 *   - `repoId` (optional) — filter issues to a specific repo
 *   - `state` (optional, default `"open"`) — issue state filter
 *   - `hideDismissed` (optional) — hide dismissed issues when `"true"`
 */
import { NextResponse } from "next/server";
import { eq, and, desc, inArray } from "drizzle-orm";
import { auth } from "@/auth";
import { typedDb } from "@/lib/db/query";
import { issues, repos, triageState } from "@/lib/db/schema";

/**
 * Fetches issues belonging to the current user's connected repos.
 * Uses a targeted triage lookup (filtered by matching issue IDs)
 * instead of scanning the entire triage table.
 *
 * @param req - Incoming request; query params `repoId`, `state`, `hideDismissed` are read from the URL
 * @returns JSON array of issue objects, each augmented with a `triage` property (or `null`)
 */
export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const repoId = searchParams.get("repoId");
  const state = searchParams.get("state") ?? "open";
  const hideDismissed = searchParams.get("hideDismissed") === "true";

  // Get user's connected repo IDs
  const userRepos = await typedDb
    .select({ id: repos.id })
    .from(repos)
    .where(eq(repos.userId, session.user.id));

  const repoIds: string[] = userRepos.map((r: { id: string }) => r.id);
  if (repoIds.length === 0) {
    return NextResponse.json([]);
  }

  // Build conditions — always filter by state and user's repos
  const repoIdSet = new Set(repoIds);
  let conditions = and(
    eq(issues.state, state),
    repoId && repoIdSet.has(repoId) ? eq(issues.repoId, repoId) : inArray(issues.repoId, repoIds)
  )!;

  const issueRows = await typedDb
    .select()
    .from(issues)
    .where(conditions)
    .orderBy(desc(issues.updatedAt));

  if (issueRows.length === 0) {
    return NextResponse.json([]);
  }

  // Fetch triage state only for the matching issue IDs (not entire table)
  const issueIds: string[] = issueRows.map((i: { id: string }) => i.id);

  const triageRows = await typedDb
    .select()
    .from(triageState)
    .where(and(eq(triageState.userId, session.user.id), inArray(triageState.issueId, issueIds)));

  const triageMap = new Map<string, (typeof triageRows)[0]>();
  for (const t of triageRows) {
    triageMap.set(t.issueId, t);
  }

  let result = issueRows.map((issue: Record<string, unknown>) => ({
    ...issue,
    triage: triageMap.get(issue.id as string) ?? null,
  }));

  // Filter out dismissed issues if requested
  if (hideDismissed) {
    result = result.filter((r: { triage: { dismissed: boolean } | null }) => !r.triage?.dismissed);
  }

  return NextResponse.json(result);
}
