/**
 * @module repos/use-connected-repos
 *
 * The connected-repository list shared by the shell, the queue, the reading
 * pane, the repo manager, and the preset picker. One query definition keeps the
 * fixture path and the fetch from drifting apart.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { devRepos, readDataMode } from "@/features/dev-tools/data-mode";

/** A connected repository as the repos API returns it. */
export interface ConnectedRepo {
  id: string;
  provider: string;
  owner: string;
  name: string;
  fullName: string;
  permission: string;
  syncMode: string;
  syncEnabled: boolean;
}

/** Query key shared by every consumer. */
export const CONNECTED_REPOS_KEY = ["connected-repos"] as const;

/**
 * Loads the user's connected repositories.
 *
 * The dev-only data toggle swaps the real list for its fixture, which is what
 * keeps the queue's repository labels populated in fixture mode. A failed
 * response throws so react-query can retry and report the error instead of
 * caching an empty list as if the user had no repositories.
 */
export function useConnectedRepos() {
  return useQuery<ConnectedRepo[]>({
    queryKey: CONNECTED_REPOS_KEY,
    queryFn: async () => {
      const fixture = await devRepos(readDataMode());
      if (fixture) return fixture;
      const res = await fetch("/api/repos");
      if (!res.ok) throw new Error("Could not load connected repositories.");
      return res.json();
    },
    staleTime: 60_000,
  });
}
