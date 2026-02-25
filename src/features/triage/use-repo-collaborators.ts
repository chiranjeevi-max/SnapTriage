"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProviderCollaborator } from "@/lib/provider-interface";

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
