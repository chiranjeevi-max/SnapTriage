import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { issues, repos, syncLog, triageState } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { payloadToIssueUpdate, type PendingChanges } from "@/features/triage/types";

interface SyncResult {
  repoId: string;
  status: "completed" | "failed";
  issuesFetched: number;
  error?: string;
}

/** Sync a single repo: fetch issues from provider, upsert into DB */
export async function syncRepo(repoId: string, userId: string): Promise<SyncResult> {
  const logId = crypto.randomUUID();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repoRows = await (db as any)
    .select()
    .from(repos)
    .where(and(eq(repos.id, repoId), eq(repos.userId, userId)));

  const repo = repoRows[0];
  if (!repo) return { repoId, status: "failed", issuesFetched: 0, error: "Repo not found" };

  // Log sync start
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).insert(syncLog).values({
    id: logId,
    repoId,
    status: "started",
  });

  try {
    const token = await getProviderToken(userId, repo.provider);
    if (!token) throw new Error(`No ${repo.provider} token found`);

    const provider = getProvider(repo.provider);
    const since = repo.lastSyncedAt ? new Date(repo.lastSyncedAt) : undefined;
    const fetched = await provider.fetchIssues(repo.owner, repo.name, token, since);

    // Upsert issues
    for (const issue of fetched) {
      // Check if issue already exists
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existing = await (db as any)
        .select()
        .from(issues)
        .where(and(eq(issues.repoId, repoId), eq(issues.providerIssueId, issue.providerIssueId)));

      if (existing.length > 0) {
        // Update
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
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
          .where(eq(issues.id, existing[0].id));
      } else {
        // Insert
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).insert(issues).values({
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
        });
      }
    }

    // Update repo lastSyncedAt
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any).update(repos).set({ lastSyncedAt: new Date() }).where(eq(repos.id, repoId));

    // Log sync completion
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .update(syncLog)
      .set({ status: "completed", issuesFetched: fetched.length, completedAt: new Date() })
      .where(eq(syncLog.id, logId));

    return { repoId, status: "completed", issuesFetched: fetched.length };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown error";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)
      .update(syncLog)
      .set({ status: "failed", error: errorMsg, completedAt: new Date() })
      .where(eq(syncLog.id, logId));

    return { repoId, status: "failed", issuesFetched: 0, error: errorMsg };
  }
}

/** Sync all enabled repos for a user */
export async function syncAllRepos(userId: string): Promise<SyncResult[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userRepos = await (db as any)
    .select()
    .from(repos)
    .where(and(eq(repos.userId, userId), eq(repos.syncEnabled, true)));

  const results: SyncResult[] = [];
  for (const repo of userRepos) {
    const result = await syncRepo(repo.id, userId);
    results.push(result);
  }

  return results;
}

/** Push all pending batch changes for a user to their providers */
export async function pushBatchChanges(
  userId: string
): Promise<{ pushed: number; failed: number }> {
  // Find all batch-pending triage rows for this user
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingRows = await (db as any)
    .select()
    .from(triageState)
    .where(and(eq(triageState.userId, userId), eq(triageState.batchPending, true)));

  let pushed = 0;
  let failed = 0;

  for (const row of pendingRows) {
    try {
      const changes = (row.pendingChanges ?? {}) as PendingChanges;
      const issueUpdate = payloadToIssueUpdate(changes);

      // Skip if no provider changes to push
      if (Object.keys(issueUpdate).length === 0) {
        // Just clear the batch pending flag
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any)
          .update(triageState)
          .set({ batchPending: false, pendingChanges: {}, updatedAt: new Date() })
          .where(eq(triageState.id, row.id));
        pushed++;
        continue;
      }

      // Get the issue and repo
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const issueRows = await (db as any).select().from(issues).where(eq(issues.id, row.issueId));
      const issue = issueRows[0];
      if (!issue) {
        failed++;
        continue;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const repoRows = await (db as any).select().from(repos).where(eq(repos.id, issue.repoId));
      const repo = repoRows[0];
      if (!repo) {
        failed++;
        continue;
      }

      const token = await getProviderToken(userId, repo.provider);
      if (!token) {
        failed++;
        continue;
      }

      const provider = getProvider(repo.provider);
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).update(issues).set(localUpdate).where(eq(issues.id, row.issueId));
      }

      // Clear batch pending
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (db as any)
        .update(triageState)
        .set({ batchPending: false, pendingChanges: {}, updatedAt: new Date() })
        .where(eq(triageState.id, row.id));

      pushed++;
    } catch {
      failed++;
    }
  }

  return { pushed, failed };
}
