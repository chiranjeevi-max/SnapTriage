/**
 * @module inbox/components/issue-list
 *
 * Scrollable list of issues shown in the left pane of the inbox split view.
 * Supports keyboard-driven selection (via parent), priority badges, labels,
 * loading skeletons, and an empty-state message.
 */
"use client";

import { useEffect, useRef, memo } from "react";
import Link from "next/link";
import { measureElement, useVirtualizer } from "@tanstack/react-virtual";
import { CircleDot, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn, formatRelativeTime } from "@/lib/utils";
import { priorityLabels } from "@/features/triage/priority";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

const EMPTY_SELECTED = new Set<string>();
const ESTIMATED_ROW_HEIGHT = 76;

interface IssueListProps {
  issues: IssueWithTriage[];
  selectedIndex: number;
  onSelect: (issue: IssueWithTriage) => void;
  isLoading: boolean;
  selectedIds?: Set<string>;
  onToggleSelected?: (issueId: string) => void;
}

/**
 * Scrollable issue list with loading skeletons and empty state.
 * The virtualizer keeps the keyboard selection in view.
 */
export function IssueList({
  issues,
  selectedIndex,
  onSelect,
  isLoading,
  selectedIds = EMPTY_SELECTED,
  onToggleSelected,
}: IssueListProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: isLoading ? 0 : issues.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ESTIMATED_ROW_HEIGHT,
    // Hidden panes report zero; caching that makes restored rows shift the queue.
    measureElement: (element, entry, instance) =>
      measureElement(element, entry, instance) || ESTIMATED_ROW_HEIGHT,
    overscan: 6,
  });

  useEffect(() => {
    if (selectedIndex >= 0 && issues.length > 0) {
      virtualizer.scrollToIndex(selectedIndex, { align: "auto" });
    }
  }, [selectedIndex, virtualizer, issues.length]);

  if (isLoading) {
    return (
      <div className="space-y-1 p-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-md p-3">
            <Skeleton className="h-4 w-4 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare className="h-5 w-5" />}
        title="No issues to triage"
        description="Connect a repository and sync it, and the queue fills up here."
        action={
          <Button asChild size="sm" variant="outline">
            <Link href="/repos">Connect a repository</Link>
          </Button>
        }
        className="h-full"
      />
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto" role="listbox" aria-label="Issue queue">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const issue = issues[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <IssueRow
                issue={issue}
                isSelected={virtualItem.index === selectedIndex}
                onSelect={onSelect}
                isSelectedForBulk={selectedIds.has(issue.id)}
                onToggleSelected={onToggleSelected}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Single issue row with priority badge, title, metadata, and truncated labels. */
// ⚡ Bolt: Wrap IssueRow in React.memo so that changing the selection index (via keyboard or click)
// only re-renders the newly selected and previously selected rows (O(1)), instead of all rows (O(N)).
const IssueRow = memo(function IssueRow({
  issue,
  isSelected,
  onSelect,
  isSelectedForBulk,
  onToggleSelected,
}: {
  issue: IssueWithTriage;
  isSelected: boolean;
  onSelect: (issue: IssueWithTriage) => void;
  isSelectedForBulk: boolean;
  onToggleSelected?: (issueId: string) => void;
}) {
  const priority = issue.triage?.priority != null ? priorityLabels[issue.triage.priority] : null;

  return (
    <div className="issue-row group relative flex items-start gap-1 border-b border-border/70">
      {onToggleSelected && (
        <input
          type="checkbox"
          aria-label={`Select ${issue.title} (#${issue.number})`}
          checked={isSelectedForBulk}
          aria-checked={isSelectedForBulk}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggleSelected(issue.id)}
          className="ml-3 mt-5 h-4 w-4 shrink-0 accent-primary opacity-50 transition-opacity checked:opacity-100 focus-visible:opacity-100 group-hover:opacity-100"
        />
      )}
      <button
        role="option"
        aria-selected={isSelected}
        onClick={() => onSelect(issue)}
        className={cn(
          "issue-row-button flex min-w-0 flex-1 items-start gap-3 px-4 py-4 text-left transition-colors",
          isSelected ? "is-selected text-foreground" : "text-foreground hover:bg-muted/50"
        )}
        style={{ contentVisibility: "auto", containIntrinsicSize: "76px" }}
      >
        <CircleDot
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            issue.state === "open" ? "text-[var(--state-open)]" : "text-muted-foreground/60"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {priority && (
              <Badge
                variant="outline"
                className={cn("shrink-0 px-1.5 py-0 text-xs leading-4", priority.className)}
              >
                {priority.label}
              </Badge>
            )}
            <span
              className="line-clamp-2 break-words text-sm font-medium leading-relaxed [overflow-wrap:anywhere]"
              title={issue.title}
            >
              {issue.title}
            </span>
          </div>
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">#{issue.number}</span>
            {issue.author && (
              <span className="max-w-40 truncate" title={issue.author}>
                by {issue.author}
              </span>
            )}
            <span className="font-mono">{formatRelativeTime(issue.updatedAt)}</span>
          </div>
          {issue.labels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {issue.labels.slice(0, 3).map((label) => (
                <span
                  key={label}
                  className="max-w-full truncate rounded bg-muted px-1.5 py-px text-xs leading-4 text-muted-foreground"
                >
                  {label}
                </span>
              ))}
              {issue.labels.length > 3 && (
                <span className="text-xs text-muted-foreground/70">+{issue.labels.length - 3}</span>
              )}
            </div>
          )}
        </div>
      </button>
    </div>
  );
});
