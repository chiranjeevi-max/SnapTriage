import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

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

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

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

interface SyncStatusEntry {
  repoId: string;
  fullName: string;
  lastSyncedAt: string | null;
}

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
