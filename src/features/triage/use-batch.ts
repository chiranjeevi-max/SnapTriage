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

/** What the pending-changes endpoint returns. */
interface PendingBatchResponse {
  count: number;
  pending: PendingChanges[];
}

/**
 * The staged work waiting for a batch push.
 *
 * One query for both the count and the diffs: they come from the same rows, and
 * fetching them separately doubled the polling traffic for a single number and a
 * single list.
 *
 * The diffs are read from the rows a push selects, not from the loaded queue,
 * because the queue holds open issues only and a staged change on a closed issue
 * is still pushed.
 */
function usePendingBatch() {
  return useQuery<PendingBatchResponse>({
    queryKey: ["batch-pending-changes"],
    queryFn: async () => {
      const res = await fetch("/api/batch/pending-count");
      if (!res.ok) throw new Error("Failed to fetch pending changes");
      const data = (await res.json()) as Partial<PendingBatchResponse>;
      return {
        count: data.count ?? 0,
        // A row written before the column existed can carry null.
        pending: (data.pending ?? []).filter((row): row is PendingChanges => row != null),
      };
    },
    refetchInterval: 30_000,
  });
}

/**
 * Query hook for the number of pending (un-pushed) batch changes.
 * Re-fetches every 30 seconds.
 *
 * @returns A TanStack `UseQueryResult<number>` with the pending change count.
 */
export function usePendingBatchCount() {
  const query = usePendingBatch();
  return { ...query, data: query.data?.count };
}

/**
 * The staged diffs a push would send, for the preview.
 *
 * @returns The staged changes in the order the database returned them.
 */
export function usePendingBatchChanges() {
  const query = usePendingBatch();
  return { ...query, data: query.data?.pending };
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
      queryClient.invalidateQueries({ queryKey: ["batch-pending-changes"] });
    },
    onError: () => {
      toast.error("Failed to push batch changes");
    },
  });
}
