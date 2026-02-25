/**
 * @module triage/use-repo-labels
 * React hook for fetching the available labels for a given repository.
 * Results are cached for 10 minutes via TanStack Query.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProviderLabel } from "@/lib/provider-interface";

/**
 * Fetch the list of labels available on a repository.
 * The query is disabled when `repoId` is `undefined` and returns an
 * empty array as a fallback.
 *
 * @param repoId - The internal repository ID, or `undefined` if no repo is selected.
 * @returns A TanStack `UseQueryResult<ProviderLabel[]>` with the label list.
 */
export function useRepoLabels(repoId: string | undefined) {
  return useQuery<ProviderLabel[]>({
    queryKey: ["repo-labels", repoId],
    queryFn: async () => {
      if (!repoId) return [];
      const res = await fetch(`/api/repos/${repoId}/labels`);
      if (!res.ok) throw new Error("Failed to fetch labels");
      return res.json();
    },
    enabled: !!repoId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}
