/**
 * @module triage/components/sync-status
 * Displays the last sync time across all repositories and provides a manual
 * refresh button. Shows a spinner while a sync is in progress.
 */
"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Kbd } from "@/features/keyboard";
import { useSyncStatus, useSync } from "@/features/inbox/use-issues";

/**
 * Format an ISO date string into a human-readable relative time
 * (e.g., "Just synced", "5m ago", "2h ago", "3d ago").
 *
 * @param isoStr - ISO 8601 date string of the last sync, or `null` if never synced.
 * @returns A human-readable string describing how long ago the sync occurred.
 */
function formatSyncTime(isoStr: string | null): string {
  if (!isoStr) return "Never synced";
  const diffMs = Date.now() - new Date(isoStr).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "Just synced";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Sync status indicator and manual refresh button.
 * Shows the most recent sync time across all repos and triggers
 * a full sync when clicked. Keyboard shortcut: `R`.
 *
 * @returns The sync status button wrapped in a tooltip.
 */
export function SyncStatus() {
  const { data: statuses } = useSyncStatus();
  const sync = useSync();

  // Show the most recent sync time across all repos
  const lastSynced =
    statuses?.reduce<string | null>((latest, s) => {
      if (!s.lastSyncedAt) return latest;
      if (!latest) return s.lastSyncedAt;
      return new Date(s.lastSyncedAt) > new Date(latest) ? s.lastSyncedAt : latest;
    }, null) ?? null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => sync.mutate(undefined)}
          disabled={sync.isPending}
        >
          {sync.isPending ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          {formatSyncTime(lastSynced)}
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-1.5">
        <span>Sync issues</span>
        <Kbd>R</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
