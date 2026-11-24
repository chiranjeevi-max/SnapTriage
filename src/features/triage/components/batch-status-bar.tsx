/**
 * @module triage/components/batch-status-bar
 * Sticky status bar shown at the bottom of the inbox when there are pending
 * batch changes. Displays what is staged and a "Push" button (with keyboard
 * shortcut hint) to write it back to the provider.
 */
"use client";

import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd, formatShortcutById } from "@/features/keyboard";
import {
  usePendingBatchCount,
  usePendingBatchChanges,
  useBatchPush,
} from "@/features/triage/use-batch";
import {
  describePending,
  hasProviderChanges,
  summarizePending,
} from "@/features/triage/pending-summary";
/**
 * Bottom status bar for batch mode. Renders what is pending and a push button.
 * Hidden when there are no pending changes.
 *
 * @returns The batch status bar element, or `null` when there are no pending changes.
 */

export function BatchStatusBar() {
  const { data: count } = usePendingBatchCount();
  // The staged diffs come from the same rows the push selects, not from the
  // loaded queue: the queue is open issues only, so a closed issue's staged
  // change was pushed without appearing here.
  const { data: pending } = usePendingBatchChanges();
  const batchPush = useBatchPush();

  if (!count || count === 0) return null;

  const summary = summarizePending(pending ?? []);
  const lines = describePending(summary);
  // A push that stages only personal fields still clears the flag without calling
  // the provider, so saying "nothing will be sent" is the honest reading of it.
  const reachesProvider = hasProviderChanges(summary);

  return (
    <div className="flex items-start justify-between gap-4 border-t bg-card px-6 py-3">
      <div className="min-w-0 text-xs text-muted-foreground">
        <span>
          {count} pending change{count !== 1 ? "s" : ""}
        </span>
        {lines.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            {lines.map((line) => (
              <li key={line.label} className="tabular-nums">
                <span className="text-foreground">{line.label}</span>
                {line.values.length > 0 && <>: {line.values.join(", ")}</>}
              </li>
            ))}
          </ul>
        )}
        {summary.issues > 0 && !reachesProvider && (
          <p className="mt-1">No provider changes staged; pushing clears the queue only.</p>
        )}
      </div>
      <Button
        size="sm"
        variant="default"
        onClick={() => batchPush.mutate()}
        disabled={batchPush.isPending}
        className="h-9 shrink-0 gap-2 px-3 text-xs"
      >
        <Upload className="h-3.5 w-3.5" />
        Push
        <Kbd tone="inverse" className="ml-0.5">
          {formatShortcutById("batch-push")}
        </Kbd>
      </Button>
    </div>
  );
}
