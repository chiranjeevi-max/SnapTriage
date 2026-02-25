"use client";

import { useQuery } from "@tanstack/react-query";
import type { ProviderLabel } from "@/lib/provider-interface";

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
