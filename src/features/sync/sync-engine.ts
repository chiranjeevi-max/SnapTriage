/**
 * @module sync/sync-engine
 * Server-side sync engine responsible for fetching issues from upstream providers
 * (GitHub/GitLab), upserting them into the local database, and pushing pending
 * batch changes back to the provider. This module runs exclusively on the server.
 */
import { eq, and, getTableColumns, inArray, sql, type InferSelectModel } from "drizzle-orm";
import { typedDb, runTransaction } from "@/lib/db/query";
import { issues, repos, syncLog, triageState } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { payloadToIssueUpdate, type PendingChanges } from "@/features/triage/types";
import { syncLogger } from "@/lib/logger";

/** Maximum number of repos to sync in parallel. */
const SYNC_CONCURRENCY = 3;

/**
 * Slack subtracted from a sync's start instant before it is stored as the
 * watermark.
 *
 * Both providers filter `since` / `updated_after` strictly, and they stamp
 * `updated_at` with their own clocks. Storing the exact start instant assumes
 * those clocks agree with ours; where the provider's runs behind, an issue
 * updated in the window carries an `updated_at` earlier than the watermark and
 * is skipped forever. The overlap costs one re-read of a minute's worth of
 * issues, which the upsert absorbs, and removes that assumption.
 */
const WATERMARK_SKEW_MARGIN_MS = 60_000;

/**
 * Issues written per upsert statement: as many as fit in SQLite's limit of
 * 32,766 bound parameters, since each row binds one parameter per column.
 */
const UPSERT_BATCH_SIZE = Math.floor(32_766 / Object.keys(getTableColumns(issues)).length);

/**
 * Result of syncing a single repository.
 *
 * @property repoId - The ID of the repository that was synced.
 * @property status - Whether the sync completed or failed.
 * @property issuesFetched - Number of issues fetched from the provider.
 * @property error - Error message, present only when `status` is `"failed"`.
 */
interface SyncResult {
  repoId: string;
  status: "completed" | "failed";
  issuesFetched: number;
  error?: string;
}

/**
 * The value an upsert proposed for a column. Quoted, since Postgres folds an
 * unquoted name such as `authorAvatar` to lower case.
 */
function excluded(column: { name: string }) {
  return sql`excluded.${sql.identifier(column.name)}`;
}

/**
 * Sync a single repository: fetch issues from the upstream provider since the
 * last sync time, upsert them into the local database, and log the sync result.
 *
 * @param repoId - The internal ID of the repository to sync.
 * @param userId - The ID of the authenticated user who owns the repo.
 * @returns A {@link SyncResult} indicating success/failure and the number of issues fetched.
 */
export async function syncRepo(repoId: string, userId: string): Promise<SyncResult> {
  const logId = crypto.randomUUID();
  // Named for the catch block: the repository may never have been read.
  let repoName: string | undefined;

  try {
    // The repository read is inside the guard too. When the database is the
    // failing component this is the *first* thing that fails, and a plain read
    // here would reject out of the single-repo route as a bare 500 instead of
    // the failed `SyncResult` the caller is promised.
    const repoRows = await typedDb
      .select()
      .from(repos)
      .where(and(eq(repos.id, repoId), eq(repos.userId, userId)));

    const repo = repoRows[0];
    if (!repo) return { repoId, status: "failed", issuesFetched: 0, error: "Repo not found" };
    repoName = repo.fullName;

    syncLogger.info({ repoId, fullName: repo.fullName, provider: repo.provider }, "Sync started");

    // Inside the try: when the database itself is the failing component, this
    // write throws too, and the call must still return a failed SyncResult
    // rather than rejecting out of the route handler that awaited it.
    await typedDb.insert(syncLog).values({
      id: logId,
      repoId,
      status: "started",
    });

    const token = await getProviderToken(userId, repo.provider as "github" | "gitlab");
    if (!token) throw new Error(`No ${repo.provider} token found`);

    const provider = getProvider(repo.provider as "github" | "gitlab");
    // The watermark is the instant the read *started*, not the instant the
    // write finished. An issue updated while the pages are still coming in has
    // an `updated_at` earlier than a finish-time stamp, and the next sync's
    // strict `since` would step over it — losing the change permanently rather
    // than delaying it.
    const syncStartedAt = Date.now();
    const since = repo.lastSyncedAt ? new Date(repo.lastSyncedAt) : undefined;
    const fetched = await provider.fetchIssues(repo.owner, repo.name, token, since);

    // Deduplicate provider rows by their conflict key before upserting.
    const uniqueFetched = Array.from(
      new Map(fetched.map((issue) => [issue.providerIssueId, issue])).values()
    );

    // Upsert in batches rather than one statement per issue. A failed batch
    // leaves earlier ones written, which is harmless: lastSyncedAt only moves
    // once every batch is in, so the retry fetches and rewrites them all.
    if (uniqueFetched.length > 0) {
      const values = uniqueFetched.map((issue) => ({
        repoId,
        provider: repo.provider,
        number: issue.number,
        title: issue.title,
        body: issue.body,
        author: issue.author,
        authorAvatar: issue.authorAvatar,
        state: issue.state,
        labels: issue.labels,
        assignees: issue.assignees,
        url: issue.url,
        providerIssueId: issue.providerIssueId,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        fetchedAt: new Date(),
      }));

      for (let start = 0; start < values.length; start += UPSERT_BATCH_SIZE) {
        await typedDb
          .insert(issues)
          .values(values.slice(start, start + UPSERT_BATCH_SIZE))
          .onConflictDoUpdate({
            target: [issues.repoId, issues.providerIssueId],
            set: {
              number: excluded(issues.number),
              title: excluded(issues.title),
              body: excluded(issues.body),
              author: excluded(issues.author),
              authorAvatar: excluded(issues.authorAvatar),
              state: excluded(issues.state),
              labels: excluded(issues.labels),
              assignees: excluded(issues.assignees),
              url: excluded(issues.url),
              updatedAt: excluded(issues.updatedAt),
              fetchedAt: excluded(issues.fetchedAt),
            },
          });
      }
    }

    // Update repo lastSyncedAt
    await typedDb
      .update(repos)
      .set({ lastSyncedAt: new Date(syncStartedAt - WATERMARK_SKEW_MARGIN_MS) })
      .where(eq(repos.id, repoId));

    // Log sync completion. Counts the rows actually written, which is also what
    // the log line below reports; `fetched.length` counted pre-dedup, so one
    // sync could report two different totals depending on where it was read.
    await typedDb
      .update(syncLog)
      .set({ status: "completed", issuesFetched: uniqueFetched.length, completedAt: new Date() })
      .where(eq(syncLog.id, logId));

    syncLogger.info(
      {
        repoId,
        fullName: repo.fullName,
        total: uniqueFetched.length,
      },
      "Sync completed"
    );

    return { repoId, status: "completed", issuesFetched: uniqueFetched.length };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";

    syncLogger.error({ repoId, fullName: repoName, error: errorMsg }, "Sync failed");

    // The failure record is written by the same database that may have just
    // failed. Letting its error escape would replace a reportable failure with a
    // rejected promise, so the single-repo route — which calls `syncRepo`
    // directly — would answer a bare 500 with no sync outcome at all.
    try {
      await typedDb
        .update(syncLog)
        .set({ status: "failed", error: errorMsg, completedAt: new Date() })
        .where(eq(syncLog.id, logId));
    } catch (logError) {
      syncLogger.error(
        { repoId, error: logError instanceof Error ? logError.message : String(logError) },
        "Could not record sync failure"
      );
    }

    return { repoId, status: "failed", issuesFetched: 0, error: errorMsg };
  }
}

/**
 * Sync all enabled repositories for a given user. Runs up to
 * {@link SYNC_CONCURRENCY} repos in parallel using `p-limit`.
 *
 * @param userId - The ID of the authenticated user.
 * @returns An array of {@link SyncResult} objects, one per repository.
 */
export async function syncAllRepos(userId: string): Promise<SyncResult[]> {
  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(SYNC_CONCURRENCY);

  const userRepos = await typedDb
    .select()
    .from(repos)
    .where(and(eq(repos.userId, userId), eq(repos.syncEnabled, true)));

  syncLogger.info({ userId, repoCount: userRepos.length }, "Syncing all repos");

  const results = await Promise.allSettled(
    userRepos.map((repo: { id: string }) => limit(() => syncRepo(repo.id, userId)))
  );

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { repoId: "unknown", status: "failed" as const, issuesFetched: 0, error: String(r.reason) }
  );
}

/**
 * Push all pending batch changes for a user to their upstream providers.
 * For each pending triage row, converts the staged changes to a provider
 * update, writes it back via the provider API, updates the local issues
 * table, and clears the batch-pending flag.
 *
 * @param userId - The ID of the authenticated user whose batch changes should be pushed.
 * @returns An object with `pushed` (successfully written) and `failed` counts.
 */
export async function pushBatchChanges(
  userId: string
): Promise<{ pushed: number; failed: number }> {
  // Find all batch-pending triage rows for this user
  const pendingRows = await typedDb
    .select()
    .from(triageState)
    .where(and(eq(triageState.userId, userId), eq(triageState.batchPending, true)));

  if (pendingRows.length === 0) return { pushed: 0, failed: 0 };

  let pushed = 0;
  let failed = 0;

  type Issue = InferSelectModel<typeof issues>;
  type Repo = InferSelectModel<typeof repos>;

  // Pre-fetch related issues and repos to eliminate N+1 queries
  const issueIds = pendingRows.map((r) => r.issueId);
  const fetchedIssues = await typedDb.select().from(issues).where(inArray(issues.id, issueIds));
  const issueMap = new Map<string, Issue>(fetchedIssues.map((i) => [i.id, i]));

  const repoIds = [...new Set(fetchedIssues.map((i) => i.repoId))];
  const fetchedRepos =
    repoIds.length > 0 ? await typedDb.select().from(repos).where(inArray(repos.id, repoIds)) : [];
  const repoMap = new Map<string, Repo>(fetchedRepos.map((r) => [r.id, r]));

  // Cache tokens per provider to avoid querying the DB for every row
  const tokenCache = new Map<string, string | null>();

  for (const row of pendingRows) {
    try {
      const changes = (row.pendingChanges ?? {}) as PendingChanges;
      const issueUpdate = payloadToIssueUpdate(changes);

      // Skip if no provider changes to push
      if (Object.keys(issueUpdate).length === 0) {
        // Just clear the batch pending flag. Conditional on the revision read at
        // the start of the pass, so a personal change staged since then survives.
        await clearBatchPendingQuery(row.id, userId, row.revision);
        pushed++;
        continue;
      }

      // Get the issue and repo from memory maps
      const issue = issueMap.get(row.issueId);
      if (!issue) {
        failed++;
        continue;
      }

      const repo = repoMap.get(issue.repoId);
      if (!repo) {
        failed++;
        continue;
      }

      let token = tokenCache.get(repo.provider);
      if (token === undefined) {
        token = await getProviderToken(userId, repo.provider as "github" | "gitlab");
        tokenCache.set(repo.provider, token);
      }

      if (!token) {
        failed++;
        continue;
      }

      const provider = getProvider(repo.provider as "github" | "gitlab");
      await provider.updateIssue(repo.owner, repo.name, issue.number, token, issueUpdate);

      // Update local issues table
      const localUpdate: Record<string, unknown> = {};
      if (changes.labels) {
        const currentLabels = new Set<string>(issue.labels ?? []);
        for (const l of changes.labels.add ?? []) currentLabels.add(l);
        for (const l of changes.labels.remove ?? []) currentLabels.delete(l);
        localUpdate.labels = [...currentLabels];
      }
      if (changes.assignees) {
        const currentAssignees = new Set<string>(issue.assignees ?? []);
        for (const a of changes.assignees.add ?? []) currentAssignees.add(a);
        for (const a of changes.assignees.remove ?? []) currentAssignees.delete(a);
        localUpdate.assignees = [...currentAssignees];
      }
      if (changes.state) {
        localUpdate.state = changes.state;
      }
      // localUpdate covers the same fields as issueUpdate, so it is never empty
      // here. It commits together with the cleared flag. The issue row mirrors
      // what the provider now holds, so it is written even when the clear is
      // refused — the newer staged values stay pending for the next push.
      await runTransaction([
        typedDb.update(issues).set(localUpdate).where(eq(issues.id, row.issueId)),
        clearBatchPendingQuery(row.id, userId, row.revision),
      ]);

      pushed++;
    } catch (err) {
      syncLogger.error(
        { error: err instanceof Error ? err.message : String(err), issueId: row.issueId },
        "Failed to push batch change"
      );
      failed++;
    }
  }

  return { pushed, failed };
}

/**
 * Builds, without running, the write that marks a user's triage row as pushed.
 *
 * Conditional on `revision`, which the caller read before it sent anything to the
 * provider: a push can spend up to the request timeout on the network call, and
 * anything the user stages in that window bumps the revision. Clearing
 * unconditionally would wipe those newer values to `{}` — they were never sent,
 * and with the flag cleared nothing would ever retry them.
 *
 * A row that changed hands is left alone entirely: `batchPending` stays set and
 * the next push sends what is now staged. Re-sending the values this push already
 * delivered is harmless, since the update is a set rather than an increment.
 *
 * @param triageId - The triage state row whose staged changes were sent.
 * @param userId - The user the row belongs to.
 * @param revision - The revision the staged changes were read at.
 */
function clearBatchPendingQuery(triageId: string, userId: string, revision: number) {
  return typedDb
    .update(triageState)
    .set({
      batchPending: false,
      pendingChanges: {},
      // The token moves with the clear. A staging write that read the old
      // revision can otherwise pass its compare-and-set and replace this clear
      // with a merge built from the values the push already sent.
      revision: sql`${triageState.revision} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(triageState.id, triageId),
        eq(triageState.userId, userId),
        eq(triageState.revision, revision)
      )
    );
}
