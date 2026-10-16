/**
 * @module triage/use-bulk-triage
 *
 * Mutation for applying the same triage payload to several issues at once.
 * Requests are bounded and settled individually so one failure cannot mask the
 * results of the others. The issue cache is invalidated afterward so the UI
 * reflects the server state.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import pLimit from "p-limit";
import type { TriagePayload } from "./types";

export interface BulkTriageResult {
  requested: number;
  succeeded: number;
  failed: number;
}

export interface BulkTriageInput {
  issueIds: string[];
  payload: TriagePayload;
}

export function useBulkTriage() {
  const queryClient = useQueryClient();
  const limit = pLimit(5);

  return useMutation<BulkTriageResult, Error, BulkTriageInput>({
    mutationFn: async ({ issueIds, payload }) => {
      const results = await Promise.allSettled(
        issueIds.map((issueId) =>
          limit(async () => {
            const response = await fetch(`/api/issues/${issueId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            const text = await response.text();
            if (!response.ok) {
              throw new Error(text || `Update failed for ${issueId}`);
            }
            if (!text) return null;
            try {
              return JSON.parse(text);
            } catch {
              return null;
            }
          })
        )
      );

      const succeeded = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.length - succeeded;

      if (failed > 0) {
        const firstFailure = results.find((result) => result.status === "rejected");
        const message =
          firstFailure?.status === "rejected"
            ? (firstFailure.reason?.message ?? "Bulk update failed")
            : "Bulk update failed";
        throw Object.assign(new Error(message), { results, succeeded, failed });
      }

      return { requested: issueIds.length, succeeded, failed };
    },

    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      toast.success(`${result.succeeded} issue${result.succeeded === 1 ? "" : "s"} updated`);
    },

    onError: (error) => {
      const failed = error instanceof Error && "failed" in error ? Number(error.failed) : undefined;
      const succeeded =
        error instanceof Error && "succeeded" in error ? Number(error.succeeded) : undefined;
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      if (failed !== undefined && succeeded !== undefined) {
        toast.error(`${succeeded} updated, ${failed} failed`);
      } else {
        toast.error("Failed to update selected issues");
      }
    },
  });
}
