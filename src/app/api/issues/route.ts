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
 */
import { NextResponse } from "next/server";
import { eq, and, desc } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { issues, repos, triageState } from "@/lib/db/schema";

/**
 * Fetches issues belonging to the current user's connected repos.
 * Attaches each issue's triage state and orders results by most recently updated.
 *
 * @param req - Incoming request; query params `repoId` and `state` are read from the URL
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

  // Get user's connected repo IDs
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userRepos = await (db as any)
    .select({ id: repos.id })
    .from(repos)
    .where(eq(repos.userId, session.user.id));

  const repoIds = new Set(userRepos.map((r: { id: string }) => r.id));
  if (repoIds.size === 0) {
    return NextResponse.json([]);
  }

  // Fetch issues — filter by repo if specified
  let conditions = eq(issues.state, state);
  if (repoId && repoIds.has(repoId)) {
    conditions = and(conditions, eq(issues.repoId, repoId))!;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issueRows = await (db as any)
    .select()
    .from(issues)
    .where(conditions)
    .orderBy(desc(issues.updatedAt));

  // Filter to only user's repos (security check)
  const filtered = issueRows.filter((i: { repoId: string }) => repoIds.has(i.repoId));

  // Attach triage state for each issue
  const issueIds = filtered.map((i: { id: string }) => i.id);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const triageRows = await (db as any)
    .select()
    .from(triageState)
    .where(eq(triageState.userId, session.user.id));

  const triageMap = new Map<string, (typeof triageRows)[0]>();
  for (const t of triageRows) {
    if (issueIds.includes(t.issueId)) {
      triageMap.set(t.issueId, t);
    }
  }

  const result = filtered.map((issue: Record<string, unknown>) => ({
    ...issue,
    triage: triageMap.get(issue.id as string) ?? null,
  }));

  return NextResponse.json(result);
}
