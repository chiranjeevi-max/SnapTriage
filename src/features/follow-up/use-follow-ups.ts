/**
 * @module follow-up/use-follow-ups
 *
 * TanStack Query hooks for the follow-up queue and the three transitions that
 * move an issue through it.
 *
 * Nothing here polls. The app has no scheduler, so a check only runs when the
 * follow-up view mounts, and the server applies a 60 second cooldown so a
 * reload cannot turn into provider traffic. The list therefore carries
 * `checkedAt` and the view states it: showing a stale queue as if it were live
 * would be the one lie this feature must not tell.
 *
 * The transitions are separate hooks rather than one mutation with an action
 * parameter, because `review` carries the comment that prompted it and the
 * others do not.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { readApiError } from "@/features/presets/api-error";
import { devFollowUps, readDataMode } from "@/features/dev-tools/data-mode";
import type { FollowUpReason } from "./detection";

/** One issue the user is waiting on, as `GET /api/follow-ups` returns it. */
export interface FollowUpEntry {
  issueId: string;
  repoId: string;
  number: number;
  title: string;
  url: string;
  provider: string;
  fullName: string;
  /** `waiting` is active; `reviewed` and `stopped` are terminal until re-armed. */
  state: "waiting" | "reviewed" | "stopped";
  reason: FollowUpReason | null;
  checkedAt: string | null;
  /** `true` when something qualifying landed and the user has not reviewed it. */
  due: boolean;
}

/** The list plus the freshness stamp the view renders. */
export interface FollowUpList {
  entries: FollowUpEntry[];
  /** The newest `checkedAt` across the entries, or `null` when none was ever checked. */
  checkedAt: string | null;
}

/** What one check pass reports. */
export interface FollowUpCheckSummary {
  checked: number;
  surfaced: number;
  skipped: number;
}

/** The comment that prompted a review, when the view knows it. */
export interface ReviewTrigger {
  commentId: string | null;
  commentAt: string | null;
}

/** The transition to apply to one issue. */
export interface FollowUpActionInput {
  action: "wait" | "review" | "stop";
  /** Only read for `review`. */
  trigger?: ReviewTrigger;
}

/**
 * Lists the user's followed issues.
 *
 * @returns A TanStack query of {@link FollowUpList}.
 */
export function useFollowUps() {
  return useQuery<FollowUpList>({
    queryKey: ["follow-ups"],
    queryFn: async () => {
      const fixture = await devFollowUps(readDataMode());
      if (fixture) return fixture;
      const res = await fetch("/api/follow-ups");
      if (!res.ok) throw new Error(await readApiError(res, "Failed to fetch follow-ups"));
      return res.json();
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Runs one bounded check pass over the waiting issues.
 *
 * The refresh is an invalidation of the list key, not a `setQueryData` merge:
 * a pass can change `reason`, `checkedAt`, and `due` on any row, and merging
 * three fields by hand would drift from what the server wrote.
 *
 * A failed pass is reported quietly. Every row keeps its previous `checkedAt`,
 * which is exactly the state the view already renders as "stale", so a red
 * toast on top of that adds nothing the interface does not already say.
 *
 * @returns A TanStack mutation of {@link FollowUpCheckSummary}.
 */
export function useCheckFollowUps() {
  const queryClient = useQueryClient();

  return useMutation<FollowUpCheckSummary, Error, void>({
    mutationFn: async () => {
      const res = await fetch("/api/follow-ups", { method: "POST" });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to check follow-ups"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
    },
  });
}

/**
 * Arms, reviews, or stops one issue's follow-up.
 *
 * `armFollowUp` reads the provider's newest comment to record a baseline, so a
 * `wait` is slower than the other two; the mutation's `isPending` is what the
 * detail pane shows while that read is in flight.
 *
 * @param issueId - The issue being changed, or `undefined` when none is selected.
 * @returns A TanStack mutation; `mutate` accepts a {@link FollowUpActionInput}.
 */
export function useFollowUpAction(issueId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<FollowUpEntry | { ok: true }, Error, FollowUpActionInput>({
    mutationFn: async ({ action, trigger }) => {
      if (!issueId) throw new Error("No issue selected");
      // The dev data toggle swaps in fixture rows whose ids are synthetic, so a
      // mutation would reach the real API with an id it has never seen. Refuse
      // rather than write against the developer's own account.
      if (await devFollowUps(readDataMode())) {
        return { ok: true } as const;
      }

      const params = new URLSearchParams();
      if (action === "review" && trigger) {
        if (trigger.commentId) params.set("commentId", trigger.commentId);
        if (trigger.commentAt) params.set("commentAt", trigger.commentAt);
      }
      const suffix = params.size > 0 ? `?${params}` : "";

      const res = await fetch(`/api/issues/${issueId}/follow-up${suffix}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to update the follow-up"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["follow-ups"] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}
