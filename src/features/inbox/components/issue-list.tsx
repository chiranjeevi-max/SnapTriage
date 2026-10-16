/**
 * @module inbox/components/issue-list
 *
 * Scrollable list of issues shown in the left pane of the inbox split view.
 * Supports keyboard-driven selection (via parent), priority badges, labels,
 * loading skeletons, and an empty-state message.
 */
"use client";

import { useEffect, useRef, memo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CircleDot, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { IssueWithTriage } from "../use-issues";

const EMPTY_SELECTED = new Set<string>();

interface IssueListProps {
  issues: IssueWithTriage[];
  selectedIndex: number;
  onSelect: (issue: IssueWithTriage) => void;
  isLoading: boolean;
  selectedIds?: ReadonlySet<string>;
  onToggleSelected?: (issueId: string) => void;
}

/** Priority label config mapping P0-P3 to display text and color classes. */
const priorityLabels: Record<number, { label: string; className: string }> = {
  0: { label: "P0", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  1: { label: "P1", className: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  2: { label: "P2", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  3: { label: "P3", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
};

/**
 * Scrollable issue list with loading skeletons and empty state.
 * Each row auto-scrolls into view when selected via keyboard navigation.
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
    estimateSize: () => 76,
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
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <MessageSquare className="mb-3 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No issues found</p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Connect a repo and sync to see issues here.
        </p>
      </div>
    );
  }

  return (
    <div ref={parentRef} className="h-full overflow-auto p-1" role="listbox">
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
  const ref = useRef<HTMLButtonElement>(null);
  const priority = issue.triage?.priority != null ? priorityLabels[issue.triage.priority] : null;

  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isSelected]);

  return (
    <div className="flex items-start gap-2">
      {onToggleSelected && (
        <input
          type="checkbox"
          aria-label={`Select ${issue.title} (#${issue.number})`}
          checked={isSelectedForBulk}
          aria-checked={isSelectedForBulk}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggleSelected(issue.id)}
          className="mt-3 h-4 w-4 shrink-0 accent-primary"
        />
      )}
      <button
        ref={ref}
        role="option"
        aria-selected={isSelected}
        onClick={() => onSelect(issue)}
        className={cn(
          "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
          isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50 text-foreground"
        )}
        style={{ contentVisibility: "auto", containIntrinsicSize: "76px" }}
      >
        <CircleDot
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            issue.state === "open" ? "text-green-500" : "text-muted-foreground"
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {priority && (
              <Badge
                variant="outline"
                className={cn("shrink-0 text-[10px] px-1.5 py-0", priority.className)}
              >
                {priority.label}
              </Badge>
            )}
            <span className="truncate text-sm font-medium">{issue.title}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>#{issue.number}</span>
            {issue.author && <span>by {issue.author}</span>}
            <span>{formatRelativeTime(issue.updatedAt)}</span>
          </div>
          {issue.labels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {issue.labels.slice(0, 3).map((label) => (
                <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0">
                  {label}
                </Badge>
              ))}
              {issue.labels.length > 3 && (
                <span className="text-[10px] text-muted-foreground">
                  +{issue.labels.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      </button>
    </div>
  );
});
