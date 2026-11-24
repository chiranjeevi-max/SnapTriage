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
import type { IssueDetail, IssueWithTriage } from "@/features/inbox/use-issues";

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
/**
 * The newest optimistic write started for each issue.
 *
 * A rollback restores a snapshot taken before its own write, which would also
 * discard any write started after it. Comparing this counter lets a stale
 * failure leave the newer state alone.
 */
const latestWrite = new Map<string, number>();
let writeCounter = 0;

/**
 * Whether a failed write may still roll its own snapshot back.
 *
 * Only the newest write for an issue may: a snapshot is absolute, so restoring an
 * older one also discards the optimistic state a later write installed. Two quick
 * keystrokes would otherwise lose one of them from the pane.
 *
 * @param issueId - The issue the failed write targeted.
 * @param sequence - The order stamp that write was given.
 * @returns `true` when no later write for that issue has started.
 */
export function mayRollBack(issueId: string, sequence: number): boolean {
  return latestWrite.get(issueId) === sequence;
}

/**
 * Record that a write for an issue has started, and return its order stamp.
 *
 * Exported so the rollback rule can be exercised without rendering the hook.
 *
 * @param issueId - The issue the write targets.
 * @returns The stamp to pass to {@link mayRollBack} if the write fails.
 */
export function beginWrite(issueId: string): number {
  const sequence = ++writeCounter;
  latestWrite.set(issueId, sequence);
  return sequence;
}

/**
 * Release an issue's order stamp once its write has settled.
 *
 * Without this the map grows with every issue ever written. The check is
 * conditional so a settled write cannot drop the stamp a newer overlapping write
 * installed, which would let the older one roll back over it.
 *
 * @param issueId - The issue the settled write targeted.
 * @param sequence - The stamp that write was given.
 */
export function endWrite(issueId: string, sequence: number): void {
  if (latestWrite.get(issueId) === sequence) latestWrite.delete(issueId);
}

export function useTriageMutation() {
  const queryClient = useQueryClient();
  const pushUndo = useUndoStore((s) => s.push);
  const pushLive = useUndoStore((s) => s.pushLive);
  const removeLive = useUndoStore((s) => s.removeLive);

  const triage = useMutation({
    mutationFn: async (input: TriageMutationInput) => {
      const { issueId, payload, batch } = input;
      const res = await fetch(`/api/issues/${issueId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, batch }),
      });
      if (!res.ok) {
        // The server's sentence is the actionable one ("The provider rejected
        // this label", a permission error). Falling back to the status keeps a
        // non-JSON gateway response from showing "[object Object]".
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `The server rejected the change (${res.status}).`);
      }
      return res.json();
    },

    onMutate: async (input) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: ["issues"] });
      await queryClient.cancelQueries({ queryKey: ["issue", input.issueId] });

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

      // The detail pane reads its own key. Without an optimistic write it keeps
      // showing the pre-write state, so the next toggle is computed from stale
      // data — and a provider-accepted write that cannot be refetched would never
      // correct it.
      const detailKey = ["issue", input.issueId] as const;
      const detail = queryClient.getQueryData<IssueDetail | null>(detailKey);
      if (detail) {
        snapshots.push({ queryKey: detailKey, data: detail });
        // The merge only touches fields both shapes carry, so the update is
        // wider than `IssueDetail` and is narrowed back on assignment.
        queryClient.setQueryData<IssueDetail>(
          detailKey,
          applyPayloadToIssue(detail, input.payload) as IssueDetail
        );
      }

      const sequence = beginWrite(input.issueId);

      return { snapshots, sequence, issueId: input.issueId };
    },

    onError: (error, input, context) => {
      // Rollback all queries, but only if no later write for this issue has
      // started. Restoring an absolute snapshot otherwise discards the newer
      // write's optimistic state as well, so two quick keystrokes lose one.
      if (context && !mayRollBack(context.issueId, context.sequence)) return;

      if (context?.snapshots) {
        for (const { queryKey, data } of context.snapshots) {
          queryClient.setQueryData(queryKey, data);
        }
      }
      const detail =
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "The provider did not accept the change.";
      toast.error("Failed to update issue", {
        description: detail,
        action: {
          label: "Retry",
          onClick: () => triage.mutate(input),
        },
      });
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
        // Live mode: record the action so both the toast and `z` can reverse it.
        // The id is what stops a double undo when the user presses both.
        const undoId = pushLive({ issueId, payload, previousPayload, description });
        showUndoToast(description, () => {
          if (!removeLive(undoId)) return;
          triage.mutate({
            issueId,
            payload: previousPayload,
            previousPayload: payload,
            description: "Undid last action",
          });
        });
      }
    },

    onSettled: (data, _error, input, context) => {
      if (context) endWrite(context.issueId, context.sequence);

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

  return triage;
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
