/**
 * @module triage/triage-service
 *
 * The one server-side path that writes a triage change.
 *
 * `PATCH /api/issues/[id]` and `POST /api/issues/[id]/apply-preset` both call
 * {@link applyTriage}, so a preset cannot reach the provider through a route
 * ordinary triage does not also take.
 *
 * The ordering is why this module exists. A live write calls the provider
 * first and commits personal fields only after it succeeds, because the inline
 * implementation that preceded it wrote priority, snooze, and dismiss before
 * the provider call: a rejected label then left the personal half applied with
 * no label to show for it. Batch mode cannot half-fail, so it stages the merge
 * in a single write and never calls the provider.
 *
 * Everything is re-derived here from the session. Ownership, write permission,
 * provider limits, and the effective sync mode are all read from the database,
 * so a caller cannot widen what the payload is allowed to do by omitting a
 * check or by claiming a mode.
 */
import { and, eq } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { issues, repos, triageState } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { providerLimits, type ProviderName } from "@/lib/provider-interface";
import { getProviderToken } from "@/features/auth/get-provider-token";
import {
  mergePendingChanges,
  type PendingChanges,
  type TriagePayload,
} from "@/features/triage/types";
import { apiLogger } from "@/lib/logger";

/** How a triage write landed: written to the provider, or staged for a batch push. */
export type TriageMode = "live" | "batch";

/** One triage write, already scoped to the user who requested it. */
export interface ApplyTriageInput {
  userId: string;
  issueId: string;
  payload: TriagePayload;
  batch?: boolean;
}

/**
 * The outcome of a triage write.
 *
 * Expected failures — a missing issue, a read-only repository, a provider
 * rejection — are returned rather than thrown. Each one becomes a status code
 * in the route that called this service, so an exception would only be
 * re-caught at the boundary it came from.
 */
/** The triage values a write replaced, as read inside the same operation. */
export interface ReplacedValues {
  priority: number | null;
  labels: string[];
  assignees: string[];
}

export type ApplyTriageResult =
  | { ok: true; mode: TriageMode; applied: TriagePayload; previous: ReplacedValues }
  | { ok: false; status: number; error: string };

/**
 * Decide how a write to one repository lands.
 *
 * The repository's `syncMode` wins over the request's `batch` flag, so a batch
 * repository cannot be pushed live by a client that omits the flag, and the
 * mode a client is told about is the mode the server actually used.
 *
 * @param syncMode - The repository's stored `syncMode`.
 * @param batch - The request's own batch preference, if it sent one.
 * @returns The mode the write will use.
 */
export function resolveTriageMode(syncMode: string, batch?: boolean): TriageMode {
  return batch === true || syncMode === "batch" ? "batch" : "live";
}

/**
 * Load an issue with its repository and the user's triage row.
 *
 * The join through `repos.userId` is the ownership check: an issue in another
 * user's repository resolves to nothing here, so every caller gets "not found"
 * for it without a separate permission test that could be forgotten.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue's primary key.
 * @returns The issue, its repo, the triage row (or `null`), or `null` when unowned.
 */
export async function loadTriageContext(userId: string, issueId: string) {
  const rows = await typedDb
    .select({ issue: issues, repo: repos })
    .from(issues)
    .innerJoin(repos, eq(repos.id, issues.repoId))
    .where(and(eq(issues.id, issueId), eq(repos.userId, userId)));

  const row = rows[0];
  if (!row) return null;

  const triageRows = await typedDb
    .select()
    .from(triageState)
    .where(and(eq(triageState.issueId, issueId), eq(triageState.userId, userId)));

  return { issue: row.issue, repo: row.repo, triage: triageRows[0] ?? null };
}

/**
 * Convert the personal half of a payload into a `triage_state` update.
 *
 * `priority: null` and `dismissed: false` are meaningful values, so presence is
 * tested with `!== undefined` rather than truthiness — a clear must not be read
 * as "leave it alone".
 *
 * @param payload - The payload being applied.
 * @returns The columns to write, or `null` when the payload touches none of them.
 */
function personalFields(payload: TriagePayload): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {};
  if (payload.priority !== undefined) fields.priority = payload.priority;
  if (payload.snoozedUntil !== undefined)
    fields.snoozedUntil = payload.snoozedUntil ? new Date(payload.snoozedUntil) : null;
  if (payload.dismissed !== undefined) fields.dismissed = payload.dismissed;
  if (Object.keys(fields).length === 0) return null;
  return fields;
}

/**
 * Merge the provider-facing half of a payload into a cached issue row.
 *
 * The provider is the source of truth and has already accepted the change by
 * the time this runs; the local row is the cache being brought level with it.
 *
 * @param issue - The cached issue row.
 * @param payload - The payload the provider accepted.
 * @returns The columns to write, or `null` when no provider field was touched.
 */
function providerFields(
  issue: { labels: string[]; assignees: string[] },
  payload: TriagePayload
): Record<string, unknown> | null {
  const fields: Record<string, unknown> = {};

  if (payload.labels) {
    const current = new Set(issue.labels ?? []);
    for (const label of payload.labels.add ?? []) current.add(label);
    for (const label of payload.labels.remove ?? []) current.delete(label);
    fields.labels = [...current];
  }

  if (payload.assignees) {
    const current = new Set(issue.assignees ?? []);
    for (const login of payload.assignees.add ?? []) current.add(login);
    for (const login of payload.assignees.remove ?? []) current.delete(login);
    fields.assignees = [...current];
  }

  if (payload.state) fields.state = payload.state;

  return Object.keys(fields).length === 0 ? null : fields;
}

/**
 * How many times a staged merge is re-attempted after losing a write race.
 *
 * Three is enough to absorb the realistic case — two tabs, occasionally a third
 * writer — without a loop that could run long under contention. Exhausting them
 * is reported rather than retried forever.
 */
const STAGE_RETRIES = 3;

/**
 * Apply one triage payload to one of the user's issues.
 *
 * Batch repositories merge into `triage_state.pendingChanges` and set
 * `batchPending`; nothing reaches the provider until an explicit push. Live
 * repositories call the provider first and commit the personal fields and the
 * cached issue row only once that call has succeeded, so a failed write leaves
 * the issue exactly as it was.
 *
 * @param input - The user, the issue, the payload, and an optional batch request.
 * @returns The mode used and the payload applied, or a status and message.
 */
export async function applyTriage(input: ApplyTriageInput): Promise<ApplyTriageResult> {
  const { userId, issueId, payload, batch } = input;
  const startedAt = performance.now();

  const context = await loadTriageContext(userId, issueId);
  if (!context) return { ok: false, status: 404, error: "Issue not found" };
  const { issue, repo, triage } = context;

  // Captured from the same read the write is computed from. A snapshot taken by a
  // caller before this call can name values another writer has already replaced,
  // and an undo built from it would restore a state the issue never had.
  const previous: ReplacedValues = {
    priority: triage?.priority ?? null,
    labels: [...(issue.labels ?? [])],
    assignees: [...(issue.assignees ?? [])],
  };

  const { labels, assignees, state } = payload;
  const touchesProvider = Boolean(labels || assignees || state);

  // The provider decides how long a label or a login may be. Checking before
  // anything is written keeps a value the provider would reject from changing
  // local state first.
  const limits = providerLimits[repo.provider as ProviderName];
  const overLimit = (values: string[] | undefined, max: number) =>
    values?.some((value) => value.length > max) ?? false;

  if (overLimit(labels?.add, limits.label) || overLimit(labels?.remove, limits.label)) {
    return {
      ok: false,
      status: 400,
      error: `Label names are limited to ${limits.label} characters on ${repo.provider}`,
    };
  }

  if (overLimit(assignees?.add, limits.login) || overLimit(assignees?.remove, limits.login)) {
    return {
      ok: false,
      status: 400,
      error: `Logins are limited to ${limits.login} characters on ${repo.provider}`,
    };
  }

  // GitLab reads label lists as comma-separated, so a comma would split one name
  // in two and the provider would silently apply labels the user never named.
  if (repo.provider === "gitlab") {
    const labelNames = [...(labels?.add ?? []), ...(labels?.remove ?? [])];
    if (labelNames.some((name) => name.includes(","))) {
      return { ok: false, status: 400, error: "Label names cannot contain commas on gitlab" };
    }
  }

  if (touchesProvider && repo.permission !== "admin" && repo.permission !== "write") {
    return { ok: false, status: 403, error: "Insufficient repository permission" };
  }

  const mode = resolveTriageMode(repo.syncMode, batch);

  let triageRow = triage;

  // Two concurrent first writes to the same issue would otherwise race to
  // insert; the unique index settles it and the loser re-reads the winner's row.
  const ensureTriageRow = async () => {
    if (triageRow) return triageRow.id;

    await typedDb
      .insert(triageState)
      .values({ issueId, userId, updatedAt: new Date() })
      .onConflictDoNothing({ target: [triageState.issueId, triageState.userId] });

    const existing = await typedDb
      .select()
      .from(triageState)
      .where(and(eq(triageState.issueId, issueId), eq(triageState.userId, userId)));
    if (!existing[0]) throw new Error("Failed to get triage state");
    triageRow = existing[0];
    return existing[0].id;
  };

  const personal = personalFields(payload);

  if (mode === "batch") {
    if (!personal && !touchesProvider) {
      return { ok: true, mode, applied: payload, previous };
    }

    const triageId = await ensureTriageRow();

    if (touchesProvider) {
      // Compare-and-set on `updatedAt`. A merge is read-modify-write, so two tabs
      // staging at once would otherwise both merge their own snapshot and the
      // later write would drop the earlier one's values. The write is conditional
      // on the row being unchanged since it was read; a lost race is retried
      // against the row the winner left behind rather than silently overwritten.
      for (let attempt = 0; attempt < STAGE_RETRIES; attempt++) {
        const current = await typedDb
          .select({ revision: triageState.revision, pendingChanges: triageState.pendingChanges })
          .from(triageState)
          .where(eq(triageState.id, triageId));
        const seen = current[0];
        if (!seen) break;

        const merged = mergePendingChanges(
          (seen.pendingChanges ?? {}) as PendingChanges,
          { labels, assignees, state },
          // What the issue carries upstream. A removal of a label that is staged
          // as an addition is only real when the issue already has it, and the
          // diff alone cannot tell those apart.
          issue.labels ?? [],
          issue.assignees ?? []
        );
        const written = await typedDb
          .update(triageState)
          .set({
            ...personal,
            batchPending: true,
            pendingChanges: merged as Record<string, unknown>,
            // The token and the value that invalidates it move together, so a
            // concurrent writer always sees a revision it did not read.
            revision: seen.revision + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(triageState.id, triageId), eq(triageState.revision, seen.revision)))
          .returning({ id: triageState.id });

        if (written.length > 0) {
          apiLogger.info(
            { issueId, mode, durationMs: Math.round(performance.now() - startedAt) },
            "Triage write staged for batch push"
          );
          return { ok: true, mode, applied: payload, previous };
        }
      }

      return {
        ok: false,
        status: 409,
        error: "Another change was staged at the same time. Try again.",
      };
    }

    await typedDb
      .update(triageState)
      .set({ ...personal, updatedAt: new Date() })
      .where(eq(triageState.id, triageId));

    apiLogger.info(
      { issueId, mode, durationMs: Math.round(performance.now() - startedAt) },
      "Triage write staged for batch push"
    );
    return { ok: true, mode, applied: payload, previous };
  }

  if (touchesProvider) {
    const token = await getProviderToken(userId, repo.provider as ProviderName);
    if (!token) return { ok: false, status: 403, error: "No provider token available" };

    const provider = getProvider(repo.provider);
    try {
      await provider.updateIssue(repo.owner, repo.name, issue.number, token, {
        labels,
        assignees,
        state,
      });
    } catch (err) {
      // Nothing is committed on this path: the caller's optimistic update
      // rolls back to a local state that still matches upstream.
      return {
        ok: false,
        status: 502,
        error: err instanceof Error ? err.message : "Provider update failed",
      };
    }
  }

  // Everything below runs after the provider has already accepted the write, so
  // it cannot be rolled back: a throw here would reach the route as a 500 and the
  // client would roll its optimistic update back to values upstream no longer
  // holds. The cached issue row is written first because it mirrors what the
  // provider just did — a failure in the personal write after this cannot leave
  // the cache disagreeing with upstream, and a sync would otherwise silently
  // revert the change the user just saw succeed.
  try {
    if (touchesProvider) {
      const cacheUpdate = providerFields(issue, payload);
      if (cacheUpdate) await typedDb.update(issues).set(cacheUpdate).where(eq(issues.id, issueId));
    }

    if (personal) {
      const triageId = await ensureTriageRow();
      await typedDb
        .update(triageState)
        .set({ ...personal, updatedAt: new Date() })
        .where(eq(triageState.id, triageId));
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    apiLogger.error({ issueId, mode, error: message }, "Triage write recorded nowhere");
    return {
      ok: false,
      status: 502,
      error: `${repo.provider} accepted the change, but recording it locally failed. Refresh to see the current state.`,
    };
  }

  apiLogger.info(
    { issueId, mode, durationMs: Math.round(performance.now() - startedAt) },
    "Triage write completed"
  );
  return { ok: true, mode, applied: payload, previous };
}
