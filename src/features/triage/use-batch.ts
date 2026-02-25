/**
 * @module triage/use-batch
 * React hooks for batch-mode triage operations. Provides a query hook to
 * track the number of pending batch changes and a mutation hook to push
 * all staged changes to the upstream provider.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
    },
    onError: () => {
      toast.error("Failed to push batch changes");
    },
  });
}
