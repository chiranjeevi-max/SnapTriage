/**
 * @module inbox/use-issues
 *
 * TanStack Query hooks for fetching and managing issue data from the API.
 *
 * - {@link useIssues} — Polls `/api/issues` every 5 minutes with optional repo/state filters
 * - {@link useSync} — Triggers a manual sync and invalidates issue + status queries on success
 * - {@link useSyncStatus} — Polls `/api/sync/status` every minute for last-sync timestamps
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

/** Issue record joined with its per-user triage state (nullable when untriaged). */
export interface IssueWithTriage {
  id: string;
  repoId: string;
  provider: string;
  number: number;
  title: string;
  body: string | null;
  author: string | null;
  authorAvatar: string | null;
  state: string;
  labels: string[];
  assignees: string[];
  url: string;
  providerIssueId: string;
  createdAt: string;
  updatedAt: string;
  fetchedAt: string;
  triage: {
    id: string;
    priority: number | null;
    snoozedUntil: string | null;
    dismissed: boolean;
  } | null;
}

/** Default polling interval for issue refetching (5 minutes). */
const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches issues from the API with automatic 5-minute polling.
 * @param repoId - Optional repo filter; omit for all connected repos.
 * @param state - Issue state filter (default "open").
 * @returns TanStack Query result containing the issue list.
 */
export function useIssues(repoId?: string, state: string = "open") {
  const params = new URLSearchParams({ state });
  if (repoId) params.set("repoId", repoId);

  return useQuery<IssueWithTriage[]>({
    queryKey: ["issues", repoId ?? "all", state],
    queryFn: async () => {
      const res = await fetch(`/api/issues?${params}`);
      if (!res.ok) throw new Error("Failed to fetch issues");
      return res.json();
    },
    refetchInterval: POLL_INTERVAL,
  });
}

/**
 * Mutation hook that triggers a manual sync via `POST /api/sync`.
 * Invalidates both issue and sync-status queries on success so the UI refreshes.
 * @returns TanStack Mutation with `mutate(repoId?)`.
 */
export function useSync() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (repoId?: string) => {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(repoId ? { repoId } : {}),
      });
      if (!res.ok) throw new Error("Sync failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      queryClient.invalidateQueries({ queryKey: ["sync-status"] });
    },
  });
}

/** Per-repo sync status entry returned by the sync status API. */
interface SyncStatusEntry {
  repoId: string;
  fullName: string;
  lastSyncedAt: string | null;
}

/**
 * Polls sync status for all connected repos (1-minute interval).
 * Used by {@link SyncStatus} to show last-synced timestamps in the UI.
 */
export function useSyncStatus() {
  return useQuery<SyncStatusEntry[]>({
    queryKey: ["sync-status"],
    queryFn: async () => {
      const res = await fetch("/api/sync/status");
      if (!res.ok) throw new Error("Failed to fetch sync status");
      return res.json();
    },
    refetchInterval: 60_000, // 1 minute
  });
}
