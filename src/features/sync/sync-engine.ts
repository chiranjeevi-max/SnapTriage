/**
 * @module sync/sync-engine
 * Server-side sync engine responsible for fetching issues from upstream providers
 * (GitHub/GitLab), upserting them into the local database, and pushing pending
 * batch changes back to the provider. This module runs exclusively on the server.
 */
import { eq, and, inArray } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { issues, repos, syncLog, triageState } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";
import type { ProviderIssue } from "@/lib/provider-interface";
import { payloadToIssueUpdate, type PendingChanges } from "@/features/triage/types";
import { syncLogger } from "@/lib/logger";

/** Maximum number of repos to sync in parallel. */
const SYNC_CONCURRENCY = 3;

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
 * Sync a single repository: fetch issues from the upstream provider since the
 * last sync time, upsert them into the local database, and log the sync result.
 *
 * @param repoId - The internal ID of the repository to sync.
 * @param userId - The ID of the authenticated user who owns the repo.
 * @returns A {@link SyncResult} indicating success/failure and the number of issues fetched.
 */
export async function syncRepo(repoId: string, userId: string): Promise<SyncResult> {
  const logId = crypto.randomUUID();

  const repoRows = await typedDb
    .select()
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.userId, userId)));

  const repo = repoRows[0];
  if (!repo) return { repoId, status: "failed", issuesFetched: 0, error: "Repo not found" };

  syncLogger.info({ repoId, fullName: repo.fullName, provider: repo.provider }, "Sync started");

  // Log sync start
  await typedDb.insert(syncLog).values({
    id: logId,
    repoId,
    status: "started",
  });

  try {
    const token = await getProviderToken(userId, repo.provider as "github" | "gitlab");
    if (!token) throw new Error(`No ${repo.provider} token found`);

    const provider = getProvider(repo.provider as "github" | "gitlab");
    const since = repo.lastSyncedAt ? new Date(repo.lastSyncedAt) : undefined;
    const fetched = await provider.fetchIssues(repo.owner, repo.name, token, since);

    // Upsert issues — batch approach to avoid N+1 queries
    // Pre-fetch all existing issues for this repo in one query
    const existingIssues = await typedDb
      .select({ id: issues.id, providerIssueId: issues.providerIssueId })
      .from(issues)
      .where(eq(issues.repoId, repoId));

    const existingMap = new Map<string, string>();
    for (const e of existingIssues) {
      existingMap.set(e.providerIssueId, e.id);
    }

    const toInsert: ProviderIssue[] = [];
    const toUpdate: { existingId: string; issue: ProviderIssue }[] = [];

    for (const issue of fetched) {
      const existingId = existingMap.get(issue.providerIssueId);
      if (existingId) {
        toUpdate.push({ existingId, issue });
      } else {
        toInsert.push(issue);
      }
    }

    // Batch insert new issues
    if (toInsert.length > 0) {
      const insertValues = toInsert.map((issue) => ({
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
      }));
      await typedDb.insert(issues).values(insertValues);
    }

    // Update existing issues (still sequential because Drizzle doesn't support
    // batch UPDATE with different values per row, but grouping them in a transaction is faster)
    if (toUpdate.length > 0) {
      await typedDb.transaction(async (tx) => {
        for (const { existingId, issue } of toUpdate) {
          await tx
            .update(issues)
            .set({
              title: issue.title,
              body: issue.body,
              author: issue.author,
              authorAvatar: issue.authorAvatar,
              state: issue.state,
              labels: issue.labels,
              assignees: issue.assignees,
              url: issue.url,
              updatedAt: issue.updatedAt,
              fetchedAt: new Date(),
            })
            .where(eq(issues.id, existingId));
        }
      });
    }

    // Update repo lastSyncedAt
    await typedDb.update(repos).set({ lastSyncedAt: new Date() }).where(eq(repos.id, repoId));

    // Log sync completion
    await typedDb
      .update(syncLog)
      .set({ status: "completed", issuesFetched: fetched.length, completedAt: new Date() })
      .where(eq(syncLog.id, logId));

    syncLogger.info(
      {
        repoId,
        fullName: repo.fullName,
        inserted: toInsert.length,
        updated: toUpdate.length,
        total: fetched.length,
      },
      "Sync completed"
    );

    return { repoId, status: "completed", issuesFetched: fetched.length };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";

    syncLogger.error({ repoId, fullName: repo.fullName, error: errorMsg }, "Sync failed");

    await typedDb
      .update(syncLog)
      .set({ status: "failed", error: errorMsg, completedAt: new Date() })
      .where(eq(syncLog.id, logId));

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

  // Pre-fetch related issues and repos to eliminate N+1 queries
  const issueIds = pendingRows.map((r) => r.issueId);
  const fetchedIssues = await typedDb.select().from(issues).where(inArray(issues.id, issueIds));
  const issueMap = new Map(fetchedIssues.map((i) => [i.id, i]));

  const repoIds = [...new Set(fetchedIssues.map((i) => i.repoId))];
  const fetchedRepos =
    repoIds.length > 0 ? await typedDb.select().from(repos).where(inArray(repos.id, repoIds)) : [];
  const repoMap = new Map(fetchedRepos.map((r) => [r.id, r]));

  // Cache tokens per provider to avoid querying the DB for every row
  const tokenCache = new Map<string, string | null>();

  // Transaction for batch DB updates
  await typedDb.transaction(async (tx) => {
    for (const row of pendingRows) {
      try {
        const changes = (row.pendingChanges ?? {}) as PendingChanges;
        const issueUpdate = payloadToIssueUpdate(changes);

        // Skip if no provider changes to push
        if (Object.keys(issueUpdate).length === 0) {
          // Just clear the batch pending flag
          await tx
            .update(triageState)
            .set({ batchPending: false, pendingChanges: {}, updatedAt: new Date() })
            .where(eq(triageState.id, row.id));
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
        if (Object.keys(localUpdate).length > 0) {
          await tx.update(issues).set(localUpdate).where(eq(issues.id, row.issueId));
        }

        // Clear batch pending
        await tx
          .update(triageState)
          .set({ batchPending: false, pendingChanges: {}, updatedAt: new Date() })
          .where(eq(triageState.id, row.id));

        pushed++;
      } catch (err) {
        failed++;
      }
    }
  });

  return { pushed, failed };
}
