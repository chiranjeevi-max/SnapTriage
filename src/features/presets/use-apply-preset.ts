/**
 * @module presets/use-apply-preset
 *
 * The one write in the feature: applying a stored preset to one issue.
 *
 * Three things are deliberately borrowed rather than reinvented. The optimistic
 * cache merge is {@link applyPayloadToIssue} from the triage mutation, so a
 * preset and a hand-made triage edit land in the cache identically. Undo is the
 * same mechanism the rest of the app uses — a five-second toast that PATCHes an
 * inverse payload in live mode, an entry on the batch undo stack otherwise. And
 * the inverse itself comes from {@link invertToPayload}, which only reverses
 * what the applied payload changed, against the values the server read.
 *
 * The server's answer is authoritative in two ways that matter here: it names
 * the effective mode (a repository set to batch wins over a live request), and
 * it reports whether anything changed at all. A `noChange` response gets an
 * informational toast and no undo entry, because there is nothing to reverse.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { describeResolution, invertToPayload } from "./types";
import type { PresetResolution, PreviewChange, ResolvableIssue } from "./types";
import { readApiError } from "./api-error";
import { applyPayloadToIssue } from "@/features/triage/use-triage-mutation";
import { showUndoToast, useUndoStore } from "@/features/triage/use-undo";
import type { TriagePayload } from "@/features/triage/types";
import type { IssueDetail, IssueWithTriage } from "@/features/inbox/use-issues";

/** What `POST /api/issues/:id/apply-preset` returns on success. */
export interface ApplyPresetResult {
  ok: true;
  /** The mode the server actually used; a batch repository overrides a live request. */
  mode: "live" | "batch";
  /** `true` when the issue already satisfied the preset and nothing was written. */
  noChange: boolean;
  /** The exact payload the server applied. */
  applied: TriagePayload;
  /**
   * Set when the provider accepted the change but the server could not record it.
   *
   * The user still needs to know: the issue looks right only after the next sync.
   */
  warning?: string;
  /** The preview lines the server computed with the same resolver the pane used. */
  changes: PreviewChange[];
  /** The values the write replaced, read inside the same operation. */
  previous: { priority: number | null; labels: string[]; assignees: string[] };
  /**
   * The staged diff that was in place before a batch apply, or null.
   *
   * Needed to undo correctly: an apply can cancel a staged removal by adding the
   * same label back, and `previous` cannot restore it because the cached set
   * still contains it.
   */
  staged: {
    labels?: { add?: string[]; remove?: string[] };
    assignees?: { add?: string[]; remove?: string[] };
  } | null;
}

/** Arguments for {@link useApplyPreset}. */
export interface ApplyPresetInput {
  issueId: string;
  presetId: string;
  /**
   * The revision the preview was computed from.
   *
   * Sent so the server can refuse an apply whose preview no longer matches the
   * stored preset. Omitted only where there was no preview.
   */
  expectedUpdatedAt?: string;
  /** The preset's name, used in the toast and the undo stack entry. */
  presetName: string;
  /** The resolution the user approved; it drives the optimistic cache update. */
  preview: PresetResolution;
  /** A request to stage; the server still decides and returns the effective mode. */
  batch?: boolean;
}

/** The caches a failed or no-op apply has to put back. */
interface ApplyContext {
  snapshots: Array<{ queryKey: readonly unknown[]; data: unknown }>;
  /** The issue as it was before the write, or `null` when it was never cached. */
  before: ResolvableIssue | null;
}

/**
 * Mutation that applies one preset to one issue.
 *
 * @returns A TanStack `UseMutationResult` whose `mutate` accepts an
 *          {@link ApplyPresetInput}.
 */
export function useApplyPreset() {
  const queryClient = useQueryClient();
  const pushUndo = useUndoStore((s) => s.push);

  return useMutation<ApplyPresetResult, Error, ApplyPresetInput, ApplyContext>({
    mutationFn: async ({ issueId, presetId, batch, expectedUpdatedAt }) => {
      const res = await fetch(`/api/issues/${issueId}/apply-preset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ presetId, batch, expectedUpdatedAt }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to apply preset"));
      return res.json();
    },

    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["issues"] });
      await queryClient.cancelQueries({ queryKey: ["issue", input.issueId] });

      const issueQueries = queryClient.getQueryCache().findAll({ queryKey: ["issues"] });
      const snapshots: ApplyContext["snapshots"] = issueQueries.map((query) => ({
        queryKey: query.queryKey,
        data: query.state.data,
      }));

      const detail = queryClient.getQueryData<IssueDetail | null>(["issue", input.issueId]);
      if (detail !== undefined) {
        snapshots.push({ queryKey: ["issue", input.issueId], data: detail });
      }

      const before =
        detail ??
        issueQueries
          .map((query) => query.state.data as IssueWithTriage[] | undefined)
          .find((rows) => rows?.some((issue) => issue.id === input.issueId))
          ?.find((issue) => issue.id === input.issueId) ??
        null;

      for (const query of issueQueries) {
        queryClient.setQueryData<IssueWithTriage[]>(query.queryKey, (old) => {
          if (!old) return old;
          return old.map((issue) =>
            issue.id === input.issueId ? applyPayloadToIssue(issue, input.preview.payload) : issue
          );
        });
      }

      if (detail) {
        queryClient.setQueryData<IssueDetail | null>(["issue", input.issueId], (old) =>
          old ? { ...old, ...applyPayloadToIssue(old, input.preview.payload) } : old
        );
      }

      return { snapshots, before: before ?? null };
    },

    onError: (error, _input, context) => {
      for (const { queryKey, data } of context?.snapshots ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
      toast.error(error.message);
    },

    onSuccess: (result, input, context) => {
      if (result.noChange) {
        // The pane asked for something the server found already true, so the
        // optimistic merge has to come back out before anything is reported.
        for (const { queryKey, data } of context?.snapshots ?? []) {
          queryClient.setQueryData(queryKey, data);
        }
        toast("Already applied", { description: "This issue already matches the preset." });
        return;
      }

      const resolution: PresetResolution = {
        payload: result.applied,
        changes: result.changes,
        noChange: false,
      };
      const description = `Applied "${input.presetName}"`;

      // Undo restores what the server read, never what this tab had cached. The
      // cache can be older than the write: another tab may have changed priority
      // in between, and an inverse derived from the stale copy would restore a
      // value the issue never carried.
      const inverse = invertToPayload(resolution, result.previous, result.staged);

      // The provider accepted the change but the server could not record it, so
      // the row reads correctly only after the next sync. Said plainly rather
      // than hidden behind the usual success toast.
      if (result.warning) toast.warning(result.warning);

      if (result.mode === "batch") {
        pushUndo({
          issueId: input.issueId,
          payload: result.applied,
          previousPayload: inverse,
          description,
        });
        toast(`Staged "${input.presetName}"`, { description: describeResolution(resolution) });
        queryClient.invalidateQueries({ queryKey: ["batch-pending-changes"] });
        return;
      }

      showUndoToast(description, () => {
        const reverseMutation = queryClient.getMutationCache().build(queryClient, {
          mutationFn: async () => {
            const res = await fetch(`/api/issues/${input.issueId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(inverse),
            });
            if (!res.ok) throw new Error(await readApiError(res, "Undo failed"));
            return res.json();
          },
        });
        // Refresh in both outcomes: a failed undo may still have reached the
        // provider, and leaving the list showing the applied values would be a
        // claim the app cannot support.
        reverseMutation.execute({}).finally(() => {
          queryClient.invalidateQueries({ queryKey: ["issues"] });
          queryClient.invalidateQueries({ queryKey: ["issue", input.issueId] });
        });
      });
    },

    onSettled: (_result, _error, input) => {
      queryClient.invalidateQueries({ queryKey: ["issues"] });
      queryClient.invalidateQueries({ queryKey: ["issue", input.issueId] });
    },
  });
}
