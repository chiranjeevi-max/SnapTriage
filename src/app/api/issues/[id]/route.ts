export const dynamic = "force-dynamic";

/**
 * @module /api/issues/[id]
 *
 * Handles a single issue identified by its database ID.
 *
 * `GET` returns the full issue, including its description. `PATCH` applies
 * triage updates: local-only fields (priority, snoozedUntil, dismissed) are
 * persisted directly in the `triageState` table, and provider-side fields
 * (labels, assignees, open/close state) are either written back immediately
 * (live mode) or staged in `pendingChanges` (batch mode) depending on the
 * repo's `syncMode` or the request's `batch` flag.
 *
 * - **Endpoint:** `/api/issues/:id`
 * - **HTTP Methods:** GET, PATCH
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
import { providerLimits, type ProviderName } from "@/lib/provider-interface";
import { apiLogger } from "@/lib/logger";

/**
 * Returns one issue with its description and triage state.
 *
 * The queue endpoint deliberately leaves the description out, so the pane that
 * shows a single issue asks for it here.
 *
 * @param req - The incoming request.
 * @param params - Dynamic route params containing `id` (the issue's DB primary key).
 * @returns JSON with the issue, or an error with 401/404 status.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const rows = await typedDb
    .select({ issue: issues })
    .from(issues)
    .innerJoin(repos, eq(repos.id, issues.repoId))
    .where(and(eq(issues.id, id), eq(repos.userId, session.user.id)));

  const issue = rows[0]?.issue;
  if (!issue) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }

  const triageRows = await typedDb
    .select()
    .from(triageState)
    .where(and(eq(triageState.issueId, id), eq(triageState.userId, session.user.id)));

  return NextResponse.json({ ...issue, triage: triageRows[0] ?? null });
}

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
  const userId = session.user!.id;
  const startedAt = performance.now();
  const rawBody = await req.json();
  const parsed = parseBody(triagePatchSchema, rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { priority, snoozedUntil, dismissed, labels, assignees, state, batch } = parsed.data;

  // Scope the issue to a repo owned by the current user before exposing it.
  const rows = await typedDb
    .select({ issue: issues, repo: repos })
    .from(issues)
    .innerJoin(repos, eq(repos.id, issues.repoId))
    .where(and(eq(issues.id, id), eq(repos.userId, userId)));

  const row = rows[0];
  if (!row) {
    return NextResponse.json({ error: "Issue not found" }, { status: 404 });
  }
  const { issue, repo } = row;

  // The provider decides how long a label or a login may be. Checking before
  // anything is written keeps a rejected value from changing the triage state
  // first and failing on the write-back.
  const limits = providerLimits[repo.provider as ProviderName];
  const overLimit = (values: string[] | undefined, max: number) =>
    values?.some((value) => value.length > max) ?? false;

  if (overLimit(labels?.add, limits.label) || overLimit(labels?.remove, limits.label)) {
    return NextResponse.json(
      { error: `Label names are limited to ${limits.label} characters on ${repo.provider}` },
      { status: 400 }
    );
  }

  if (overLimit(assignees?.add, limits.login) || overLimit(assignees?.remove, limits.login)) {
    return NextResponse.json(
      { error: `Logins are limited to ${limits.login} characters on ${repo.provider}` },
      { status: 400 }
    );
  }

  // Provider writeback requires write access on the repo.
  if (
    (labels || assignees || state) &&
    repo.permission !== "admin" &&
    repo.permission !== "write"
  ) {
    return NextResponse.json({ error: "Insufficient repository permission" }, { status: 403 });
  }

  const isBatchMode = batch === true || repo.syncMode === "batch";

  // Get or create triage state
  const existingTriage = await typedDb
    .select()
    .from(triageState)
    .where(and(eq(triageState.issueId, id), eq(triageState.userId, session.user.id)));

  let triageRow: (typeof existingTriage)[number] | null = existingTriage[0] ?? null;

  const ensureTriageRow = async () => {
    if (triageRow) return triageRow.id;

    await typedDb
      .insert(triageState)
      .values({ issueId: id, userId, updatedAt: new Date() })
      .onConflictDoNothing({ target: [triageState.issueId, triageState.userId] });

    const existing = await typedDb
      .select()
      .from(triageState)
      .where(and(eq(triageState.issueId, id), eq(triageState.userId, userId)));
    if (!existing[0]) throw new Error("Failed to get triage state");
    triageRow = existing[0];
    return existing[0].id;
  };

  // Update triage state in DB
  if (priority !== undefined || snoozedUntil !== undefined || dismissed !== undefined) {
    const triageData: Record<string, unknown> = { updatedAt: new Date() };
    if (priority !== undefined) triageData.priority = priority;
    if (snoozedUntil !== undefined)
      triageData.snoozedUntil = snoozedUntil ? new Date(snoozedUntil) : null;
    if (dismissed !== undefined) triageData.dismissed = dismissed;

    const triageId = await ensureTriageRow();
    await typedDb.update(triageState).set(triageData).where(eq(triageState.id, triageId));
  }

  // Handle provider changes (labels, assignees, state)
  if (labels || assignees || state) {
    if (isBatchMode) {
      // Batch mode: stage changes in pendingChanges
      const ensuredTriageId = await ensureTriageRow();

      const currentPending = (triageRow?.pendingChanges ?? {}) as PendingChanges;
      const merged = mergePendingChanges(currentPending, { labels, assignees, state });

      const batchData = {
        batchPending: true,
        pendingChanges: merged as Record<string, unknown>,
        updatedAt: new Date(),
      };

      await typedDb.update(triageState).set(batchData).where(eq(triageState.id, ensuredTriageId));
    } else {
      // Live mode: write changes to provider immediately
      const token = await getProviderToken(session.user.id, repo.provider as "github" | "gitlab");
      if (!token) {
        return NextResponse.json({ error: "No provider token available" }, { status: 403 });
      }

      const provider = getProvider(repo.provider as "github" | "gitlab");
      try {
        await provider.updateIssue(repo.owner, repo.name, issue.number, token, {
          labels,
          assignees,
          state,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Provider update failed";
        return NextResponse.json({ error: message }, { status: 502 });
      }

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

  apiLogger.info(
    { issueId: id, durationMs: Math.round(performance.now() - startedAt) },
    "Issue triage update completed"
  );
  return NextResponse.json({ ok: true });
}
