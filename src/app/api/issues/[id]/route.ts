import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { issues, repos, triageState } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { mergePendingChanges, type PendingChanges } from "@/features/triage/types";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { priority, snoozedUntil, dismissed, labels, assignees, state, batch } = body;

  // Verify issue belongs to user's repo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issueRows = await (db as any).select().from(issues).where(eq(issues.id, id));
  const issue = issueRows[0];
  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repoRows = await (db as any)
    .select()
    .from(repos)
    .where(and(eq(repos.id, issue.repoId), eq(repos.userId, session.user.id)));

  if (repoRows.length === 0) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const repo = repoRows[0];

  const isBatchMode = batch === true || repo.syncMode === "batch";

  // Get or create triage state
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingTriage = await (db as any)
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).update(triageState).set(triageData).where(eq(triageState.id, triageRow.id));
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any).insert(triageState).values({
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
        pendingChanges: merged,
        updatedAt: new Date(),
      };

      if (triageRow) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .update(triageState)
          .set(batchData)
          .where(eq(triageState.id, triageRow.id));
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).insert(triageState).values({
          issueId: id,
          userId: session.user.id,
          ...batchData,
        });
      }
    } else {
      // Live mode: write changes to provider immediately
      const token = await getProviderToken(session.user.id, repo.provider);
      if (token) {
        const provider = getProvider(repo.provider);
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (db as any).update(issues).set(issueUpdate).where(eq(issues.id, id));
        }
      }
    }
  }

  return NextResponse.json({ ok: true });
}
