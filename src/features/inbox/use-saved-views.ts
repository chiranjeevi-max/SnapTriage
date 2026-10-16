/**
 * @module inbox/use-saved-views
 *
 * TanStack Query hooks for listing and creating server-persisted inbox views.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { IssueFilter } from "./issue-filters";

export interface SavedView {
  id: string;
  userId: string;
  name: string;
  filter: IssueFilter;
  createdAt: string;
  updatedAt: string;
}

export function useSavedViews() {
  return useQuery<SavedView[]>({
    queryKey: ["saved-views"],
    queryFn: async () => {
      const res = await fetch("/api/views");
      if (!res.ok) throw new Error("Failed to fetch saved views");
      return res.json();
    },
  });
}

export function useSaveCurrentView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, filter }: { name: string; filter: IssueFilter }) => {
      const res = await fetch("/api/views", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, filter }),
      });
      if (!res.ok) throw new Error("Failed to save view");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-views"] });
    },
  });
}
