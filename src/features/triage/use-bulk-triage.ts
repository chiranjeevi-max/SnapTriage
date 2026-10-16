/**
 * @module triage/use-bulk-triage
 *
 * Mutation for applying the same triage payload to several issues at once.
 * Uses the existing per-issue PATCH route and invalidates the issue cache on
 * completion so the UI refreshes consistently. Intentionally simple: bulk work
 * is explicit and run in parallel, with a single success/error toast.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TriagePayload } from "./types";

export interface BulkTriageInput {
  issueIds: string[];
  payload: TriagePayload;
  description: string;
}

export function useBulkTriage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ issueIds, payload }: BulkTriageInput) => {
      const responses = await Promise.all(
        issueIds.map((issueId) =>
          fetch(`/api/issues/${issueId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        )
      );

      if (responses.some((response) => !response.ok)) {
        throw new Error("One or more updates failed");
      }

      return Promise.all(responses.map((response) => response.json()));
    },

    onSuccess: (_data, input) => {
      toast.success(
        `${input.issueIds.length} issue${input.issueIds.length === 1 ? "" : "s"} updated`
      );
      queryClient.invalidateQueries({ queryKey: ["issues"] });
    },

    onError: () => {
      toast.error("Failed to update selected issues");
      queryClient.invalidateQueries({ queryKey: ["issues"] });
    },
  });
}
