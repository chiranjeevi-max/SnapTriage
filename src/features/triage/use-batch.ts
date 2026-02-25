"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

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
