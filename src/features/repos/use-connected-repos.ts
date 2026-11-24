/**
 * @module repos/use-connected-repos
 *
 * The connected-repository list shared by the shell, the queue, and the reading
 * pane. The shell already loads it for the sidebar; the other surfaces read the
 * same query rather than asking the server for a second copy.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { devRepos, readDataMode } from "@/features/dev-tools/data-mode";

/** A connected repository as the repos API returns it. */
export interface ConnectedRepo {
  id: string;
  provider: string;
  fullName: string;
  permission: string;
  syncMode?: string;
  syncEnabled?: boolean;
}

/** Query key shared by every consumer. */
export const CONNECTED_REPOS_KEY = ["connected-repos"] as const;

/**
 * Loads the user's connected repositories.
 *
 * The dev-only data toggle swaps the real list for its fixture, which is what
 * keeps the queue's repository labels populated in fixture mode.
 */
export function useConnectedRepos() {
  return useQuery<ConnectedRepo[]>({
    queryKey: CONNECTED_REPOS_KEY,
    queryFn: async () => {
      const fixture = await devRepos(readDataMode());
      if (fixture) return fixture;
      const res = await fetch("/api/repos");
      return res.ok ? res.json() : [];
    },
    staleTime: 60_000,
  });
}
