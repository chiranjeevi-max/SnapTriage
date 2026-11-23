/**
 * @module triage/use-triage-mutation
 * Provides the primary mutation hook for applying triage actions to issues.
 * Supports both live mode (immediate writeback with undo toast) and batch mode
 * (stage changes locally with undo stack). Includes optimistic cache updates
 * via TanStack Query and automatic rollback on failure.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { TriagePayload } from "./types";
import { showUndoToast, useUndoStore } from "./use-undo";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

/**
 * Input shape for the triage mutation.
 *
 * @property issueId - ID of the issue to update.
 * @property payload - The triage changes to apply.
 * @property previousPayload - Inverse payload used for undo.
 * @property description - Human-readable summary of the action.
 * @property batch - When `true`, stages the change for batch push instead of live writeback.
 */
interface TriageMutationInput {
  issueId: string;
  payload: TriagePayload;
  previousPayload: TriagePayload;
  description: string;
  batch?: boolean;
}

/**
 * Whether a finished triage write should trigger a refetch.
 *
 * A warning response means the provider accepted the change but the local row
 * could not be recorded. Refetching then reads that unchanged row and replaces
 * the optimistic update with pre-write values, so the user watches their own
 * successful action revert. Only the next sync can repair the row.
 *
 * @param data - The mutation's response body, if it resolved.
 * @returns `true` when the caches should be invalidated.
 */
export function shouldRefetchAfterWrite(data: unknown): boolean {
  return !(data as { warning?: string } | null)?.warning;
}

/**
 * React hook that returns a TanStack Query mutation for triaging issues.
 * Handles optimistic updates, error rollback, undo (both live and batch),
 * and cache invalidation.
 *
 * @returns A TanStack `UseMutationResult` whose `mutate`/`mutateAsync` accept
 *          a {@link TriageMutationInput}.
 */
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

    onSuccess: (data, input) => {
      const { issueId, payload, previousPayload, description, batch } = input;

      // The provider accepted the change but the server could not record it. Said
      // plainly rather than hidden behind the usual toast, because the row will
      // look right only after the next sync.
      const warning = (data as { warning?: string } | null)?.warning;
      if (warning) toast.warning(warning);

      if (batch) {
        // Batch mode: push to undo stack
        pushUndo({ issueId, payload, previousPayload, description });
        toast("Change staged");
        // One key covers the count and the preview now that both read the same
        // query; without this the bar shows the new count beside a stale preview
        // until the next poll.
        queryClient.invalidateQueries({ queryKey: ["batch-pending-changes"] });
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
          reverseMutation.execute({}).finally(() => {
            queryClient.invalidateQueries({ queryKey: ["issues"] });
            // The detail pane reads its own key, so undoing from the queue left it
            // showing the state that was just reversed.
            queryClient.invalidateQueries({ queryKey: ["issue", issueId] });
          });
        });
      }
    },

    onSettled: (data, _error, input) => {
      // A warning means the provider accepted the change but the local row could
      // not be recorded. Refetching now would read that unchanged row and replace
      // the optimistic update with pre-write values, so the user would watch their
      // own successful action revert. The next sync repairs the row instead.
      if (!shouldRefetchAfterWrite(data)) return;

      queryClient.invalidateQueries({ queryKey: ["issues"] });
      // Only this issue's detail. The bare `["issue"]` prefix marked every cached
      // detail stale, so unrelated panes refetched when reopened.
      if (input) queryClient.invalidateQueries({ queryKey: ["issue", input.issueId] });
    },
  });
}

/**
 * Apply a {@link TriagePayload} to an {@link IssueWithTriage} for optimistic
 * cache updates. Merges label/assignee additions and removals into the
 * issue's current sets and updates local triage metadata.
 *
 * @param issue - The current issue object from the query cache.
 * @param payload - The triage payload to apply.
 * @returns A new {@link IssueWithTriage} with the payload applied.
 */
export function applyPayloadToIssue(
  issue: IssueWithTriage,
  payload: TriagePayload
): IssueWithTriage {
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
