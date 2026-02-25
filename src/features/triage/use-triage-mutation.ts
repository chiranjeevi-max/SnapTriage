"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TriagePayload } from "./types";
import { showUndoToast, useUndoStore } from "./use-undo";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

interface TriageMutationInput {
  issueId: string;
  payload: TriagePayload;
  previousPayload: TriagePayload;
  description: string;
  batch?: boolean;
}

export function useTriageMutation() {
  const queryClient = useQueryClient();
  const pushUndo = useUndoStore((s) => s.push);

  return useMutation({
    mutationFn: async (input: TriageMutationInput) => {
      const { issueId, payload, batch } = input;
      const res = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, batch }),
      });
      if (!res.ok) throw new Error("Update failed");
      return res.json();
    },

    onMutate: async (input) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["issues"] });

      // Snapshot current data from all matching queries
      const queryCache = queryClient.getQueryCache();
      const issueQueries = queryCache.findAll({ queryKey: ["issues"] });
      const snapshots: Array<{ queryKey: readonly unknown[]; data: unknown }> = [];

      for (const query of issueQueries) {
        snapshots.push({ queryKey: query.queryKey, data: query.state.data });
      }

      // Optimistically update cached issues
      for (const query of issueQueries) {
        queryClient.setQueryData<IssueWithTriage[]>(query.queryKey, (old) => {
          if (!old) return old;
          return old.map((issue) => {
            if (issue.id !== input.issueId) return issue;
            return applyPayloadToIssue(issue, input.payload);
          });
        });
      }

      return { snapshots };
    },

    onError: (_err, _input, context) => {
      // Rollback all queries
      if (context?.snapshots) {
        for (const { queryKey, data } of context.snapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      toast.error("Failed to update issue");
    },

    onSuccess: (_data, input) => {
      const { issueId, payload, previousPayload, description, batch } = input;

      if (batch) {
        // Batch mode: push to undo stack
        pushUndo({ issueId, payload, previousPayload, description });
        toast("Change staged");
        queryClient.invalidateQueries({ queryKey: ["batch-pending-count"] });
      } else {
        // Live mode: show undo toast
        showUndoToast(description, () => {
          // Fire the reverse mutation (no undo for the undo)
          const reverseMutation = queryClient.getMutationCache().build(queryClient, {
            mutationFn: async () => {
              const res = await fetch(`/api/issues/${issueId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(previousPayload),
              });
              if (!res.ok) throw new Error("Undo failed");
              return res.json();
            },
          });
          reverseMutation.execute({}).then(() => {
            queryClient.invalidateQueries({ queryKey: ["issues"] });
          });
        });
      }
    },

    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["issues"] });
    },
  });
}

/** Apply a TriagePayload to an issue for optimistic updates */
function applyPayloadToIssue(issue: IssueWithTriage, payload: TriagePayload): IssueWithTriage {
  const triage = issue.triage ?? {
    id: "",
    priority: null,
    snoozedUntil: null,
    dismissed: false,
  };

  const updated = { ...issue };
  const newTriage = { ...triage };

  if (payload.priority !== undefined) newTriage.priority = payload.priority;
  if (payload.snoozedUntil !== undefined) newTriage.snoozedUntil = payload.snoozedUntil;
  if (payload.dismissed !== undefined) newTriage.dismissed = payload.dismissed;

  if (payload.labels) {
    const labels = new Set(issue.labels);
    for (const l of payload.labels.add ?? []) labels.add(l);
    for (const l of payload.labels.remove ?? []) labels.delete(l);
    updated.labels = [...labels];
  }

  if (payload.assignees) {
    const assignees = new Set(issue.assignees);
    for (const a of payload.assignees.add ?? []) assignees.add(a);
    for (const a of payload.assignees.remove ?? []) assignees.delete(a);
    updated.assignees = [...assignees];
  }

  if (payload.state) {
    updated.state = payload.state;
  }

  updated.triage = newTriage;
  return updated;
}
