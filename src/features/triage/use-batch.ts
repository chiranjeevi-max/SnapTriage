/**
 * @module triage/use-batch
 * React hooks for batch-mode triage operations. Provides a query hook to
 * track the number of pending batch changes and a mutation hook to push
 * all staged changes to the upstream provider.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PendingChanges } from "@/features/triage/types";

/**
 * Query hook that fetches the count of pending (un-pushed) batch changes
 * for the current user. Re-fetches every 30 seconds.
 *
 * @returns A TanStack `UseQueryResult<number>` with the pending change count.
 */
export function usePendingBatchCount() {
  return useQuery<number>({
    queryKey: ["batch-pending-count"],
    queryFn: async () => {
      const res = await fetch("/api/batch/pending-count");
      if (!res.ok) throw new Error("Failed to fetch pending count");
      const data = await res.json();
      return data.count;
    },
    refetchInterval: 30_000,
  });
}

/**
 * The staged diffs a push would send, for the preview.
 *
 * Read from the same rows the push selects rather than from the loaded queue: the
 * queue holds open issues only, and a staged change on a closed issue is still
 * pushed.
 *
 * @returns The staged changes, newest state first, or an empty list.
 */
export function usePendingBatchChanges() {
  return useQuery<PendingChanges[]>({
    queryKey: ["batch-pending-changes"],
    queryFn: async () => {
      const res = await fetch("/api/batch/pending-count");
      if (!res.ok) throw new Error("Failed to fetch pending changes");
      const data = (await res.json()) as { pending?: PendingChanges[] };
      return data.pending ?? [];
    },
    refetchInterval: 30_000,
  });
}

/**
 * Mutation hook that pushes all pending batch changes to the upstream providers.
 * On success it shows a toast with the count of pushed/failed changes and
 * invalidates both the issues and pending-count query caches.
 *
 * @returns A TanStack `UseMutationResult` whose `mutate` triggers the batch push.
 */
export function useBatchPush() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/batch/push", { method: "POST" });
      if (!res.ok) throw new Error("Batch push failed");
      return res.json();
    },
    onSuccess: (data: { pushed: number; failed: number }) => {
      if (data.failed > 0) {
        toast.error(`Pushed ${data.pushed} changes, ${data.failed} failed`);
      } else {
        toast.success(`Pushed ${data.pushed} change${data.pushed !== 1 ? "s" : ""}`);
      }
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      queryClient.invalidateQueries({ queryKey: ["batch-pending-count"] });
      queryClient.invalidateQueries({ queryKey: ["batch-pending-changes"] });
    },
    onError: () => {
      toast.error("Failed to push batch changes");
    },
  });
}
