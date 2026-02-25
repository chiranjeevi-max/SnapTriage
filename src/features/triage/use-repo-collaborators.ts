/**
 * @module triage/use-repo-collaborators
 * React hook for fetching the collaborators (assignable users) for a given
 * repository. Results are cached for 10 minutes via TanStack Query.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProviderCollaborator } from "@/lib/provider-interface";

/**
 * Fetch the list of collaborators who can be assigned to issues on a repository.
 * The query is disabled when `repoId` is `undefined` and returns an
 * empty array as a fallback.
 *
 * @param repoId - The internal repository ID, or `undefined` if no repo is selected.
 * @returns A TanStack `UseQueryResult<ProviderCollaborator[]>` with the collaborator list.
 */
export function useRepoCollaborators(repoId: string | undefined) {
  return useQuery<ProviderCollaborator[]>({
    queryKey: ["repo-collaborators", repoId],
    queryFn: async () => {
      if (!repoId) return [];
      const res = await fetch(`/api/repos/${repoId}/collaborators`);
      if (!res.ok) throw new Error("Failed to fetch collaborators");
      return res.json();
    },
    enabled: !!repoId,
    staleTime: 10 * 60 * 1000, // 10 minutes
  });
}
