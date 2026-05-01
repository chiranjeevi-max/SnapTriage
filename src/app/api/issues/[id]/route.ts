export const dynamic = "force-dynamic";

/**
 * @module /api/issues/[id]
 *
 * Handles triage operations on a single issue identified by its database ID.
 * Supports updating local triage state (priority, snooze, dismiss) and
 * provider-side changes (labels, assignees, open/close state) in either
 * live or batch sync mode.
 *
 * - **Endpoint:** `/api/issues/:id`
 * - **HTTP Methods:** PATCH
 * - **Auth:** Required (session-based); the issue must belong to one of the user's repos
 */
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { typedDb } from "@/lib/db/query";
import { issues, repos, triageState } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { mergePendingChanges, type PendingChanges } from "@/features/triage/types";
import { triagePatchSchema, parseBody } from "@/lib/validations";

/**
 * Applies triage updates to a single issue.
 *
 * Local-only fields (priority, snoozedUntil, dismissed) are persisted directly
 * in the `triageState` table. Provider-side fields (labels, assignees, state)
 * are either written back immediately (live mode) or staged in `pendingChanges`
 * (batch mode) depending on the repo's `syncMode` or the request's `batch` flag.
 *
 * @param req - Request with JSON body containing any combination of:
 *   `{ priority?, snoozedUntil?, dismissed?, labels?, assignees?, state?, batch? }`
 * @param params - Dynamic route params containing `id` (the issue's DB primary key)
 * @returns JSON `{ ok: true }` on success, or an error with 400/401/403/404 status
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = await req.json();
  const parsed = parseBody(triagePatchSchema, rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { priority, snoozedUntil, dismissed, labels, assignees, state, batch } = parsed.data;

  // Verify issue belongs to user's repo
    const issueRows = await typedDb.select().from(issues).where(eq(issues.id, id));
  const issue = issueRows[0];
  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

    const repoRows = await typedDb
    .select()
    .from(repos)
    .where(and(eq(repos.id, issue.repoId), eq(repos.userId, session.user.id)));

  if (repoRows.length === 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const repo = repoRows[0];

  const isBatchMode = batch === true || repo.syncMode === "batch";

  // Get or create triage state
    const existingTriage = await typedDb
    .select()
    .from(triageState)
    .where(and(eq(triageState.issueId, id), eq(triageState.userId, session.user.id)));

  const triageRow = existingTriage[0] ?? null;

  // Update triage state in DB
  if (priority !== undefined || snoozedUntil !== undefined || dismissed !== undefined) {
    const triageData: Record<string, unknown> = { updatedAt: new Date() };
    if (priority !== undefined) triageData.priority = priority;
    if (snoozedUntil !== undefined)
      triageData.snoozedUntil = snoozedUntil ? new Date(snoozedUntil) : null;
    if (dismissed !== undefined) triageData.dismissed = dismissed;

    if (triageRow) {
            await typedDb.update(triageState).set(triageData).where(eq(triageState.id, triageRow.id));
    } else {
            await typedDb.insert(triageState).values({
        issueId: id,
        userId: session.user.id,
        ...triageData,
      });
    }
  }

  // Handle provider changes (labels, assignees, state)
  if (labels || assignees || state) {
    if (isBatchMode) {
      // Batch mode: stage changes in pendingChanges
      const currentPending = (triageRow?.pendingChanges ?? {}) as PendingChanges;
      const merged = mergePendingChanges(currentPending, { labels, assignees, state });

      const batchData = {
        batchPending: true,
        pendingChanges: merged as Record<string, unknown>,
        updatedAt: new Date(),
      };

      if (triageRow) {
                await typedDb
          .update(triageState)
          .set(batchData)
          .where(eq(triageState.id, triageRow.id));
      } else {
                await typedDb.insert(triageState).values({
          issueId: id,
          userId: session.user.id,
          ...batchData,
        });
      }
    } else {
      // Live mode: write changes to provider immediately
      const token = await getProviderToken(session.user.id, repo.provider as "github" | "gitlab");
      if (token) {
        const provider = getProvider(repo.provider as "github" | "gitlab");
        await provider.updateIssue(repo.owner, repo.name, issue.number, token, {
          labels,
          assignees,
          state,
        });

        // Also update local issues table with new labels/assignees
        const issueUpdate: Record<string, unknown> = {};
        if (labels) {
          const currentLabels = new Set<string>(issue.labels ?? []);
          for (const l of labels.add ?? []) currentLabels.add(l);
          for (const l of labels.remove ?? []) currentLabels.delete(l);
          issueUpdate.labels = [...currentLabels];
        }
        if (assignees) {
          const currentAssignees = new Set<string>(issue.assignees ?? []);
          for (const a of assignees.add ?? []) currentAssignees.add(a);
          for (const a of assignees.remove ?? []) currentAssignees.delete(a);
          issueUpdate.assignees = [...currentAssignees];
        }
        if (state) {
          issueUpdate.state = state;
        }
        if (Object.keys(issueUpdate).length > 0) {
                    await typedDb.update(issues).set(issueUpdate).where(eq(issues.id, id));
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
