export const dynamic = "force-dynamic";

/**
 * @module /api/issues/[id]
 *
 * Handles a single issue identified by its database ID.
 *
 * `GET` returns the full issue, including its description. `PATCH` applies
 * triage updates through `applyTriage` in
 * `src/features/triage/triage-service.ts`: the provider-side fields (labels,
 * assignees, open/close state) are written back immediately in live mode or
 * staged in `pendingChanges` in batch mode, and the personal fields (priority,
 * snoozedUntil, dismissed) are committed only after any provider call has
 * succeeded. A rejected provider write therefore leaves the issue exactly as
 * it was, instead of keeping a priority the label never matched.
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
import { applyTriage } from "@/features/triage/triage-service";
import { triagePatchSchema, parseBody } from "@/lib/validations";

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
 * Delegates to {@link applyTriage}, which re-derives ownership, provider
 * limits, write permission, and the effective sync mode from the database.
 * The response shape is unchanged from the inline implementation.
 *
 * @param req - Request with JSON body containing any combination of:
 *   `{ priority?, snoozedUntil?, dismissed?, labels?, assignees?, state?, batch? }`
 * @param params - Dynamic route params containing `id` (the issue's DB primary key)
 * @returns JSON `{ ok: true, warning? }` on success, or an error with
 *          400/401/403/404/409/502 status. `warning` is present when the provider
 *          accepted the change but recording it locally failed, so the caller
 *          should not roll its optimistic state back.
 *
 *          409 means a batch write lost the compare-and-set: another change was
 *          staged between the read and the write, so the merge was refused rather
 *          than overwriting it. The caller retries against the newer state.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(triagePatchSchema, rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { batch, ...payload } = parsed.data;
  const result = await applyTriage({ userId: session.user.id, issueId: id, payload, batch });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // `warning` reports a write the provider accepted but the local cache could not
  // record. It travels as a success so the client keeps its optimistic state
  // instead of rolling back to values upstream no longer holds.
  return NextResponse.json({ ok: true, warning: result.warning });
}
