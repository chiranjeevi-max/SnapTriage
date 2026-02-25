/**
 * @module triage/components/batch-status-bar
 * Sticky status bar shown at the bottom of the inbox when there are pending
 * batch changes. Displays the count of staged changes and a "Push" button
 * (with keyboard shortcut hint) to write them back to the provider.
 */
"use client";

import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/features/keyboard";
import { usePendingBatchCount, useBatchPush } from "../use-batch";

/**
 * Bottom status bar for batch mode. Renders the number of pending changes
 * and a push button. Hidden when there are no pending changes.
 *
 * @returns The batch status bar element, or `null` when there are no pending changes.
 */
export function BatchStatusBar() {
  const { data: count } = usePendingBatchCount();
  const batchPush = useBatchPush();

  if (!count || count === 0) return null;

  return (
    <div className="flex items-center justify-between border-t bg-muted/50 px-4 py-2">
      <span className="text-sm text-muted-foreground">
        {count} pending change{count !== 1 ? "s" : ""}
      </span>
      <Button
        size="sm"
        variant="default"
        onClick={() => batchPush.mutate()}
        disabled={batchPush.isPending}
      >
        <Upload className="mr-1.5 h-3.5 w-3.5" />
        Push
        <Kbd className="ml-1.5">Shift+P</Kbd>
      </Button>
    </div>
  );
}
