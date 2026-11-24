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
import { CircleDot, MessageSquare, SearchX } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn, formatRelativeTime } from "@/lib/utils";
import { priorityLabels } from "@/features/triage/priority";
import { shortenRepoName } from "@/features/repos/repo-label";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

const EMPTY_SELECTED = new Set<string>();
const ESTIMATED_ROW_HEIGHT = 88;

interface IssueListProps {
  issues: IssueWithTriage[];
  selectedIndex: number;
  onSelect: (issue: IssueWithTriage) => void;
  isLoading: boolean;
  selectedIds?: Set<string>;
  onToggleSelected?: (issueId: string) => void;
  /** Repository id → full name, so a cross-repo queue can say where a row is from. */
  repoNames?: ReadonlyMap<string, string>;
  /** The active narrowing, in user-facing words, when the queue is empty. */
  narrowedBy?: string[];
  /** Clears the search and filter that produced an empty queue. */
  onClearNarrowing?: () => void;
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
  repoNames,
  narrowedBy,
  onClearNarrowing,
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
    // "No issues yet" and "nothing matches" are different facts. Telling a user
    // with a thousand issues to connect a repository, at the moment a search
    // hid them all, is a false diagnosis with no way back.
    if (narrowedBy && narrowedBy.length > 0) {
      return (
        <EmptyState
          icon={<SearchX className="h-5 w-5" />}
          title="No issues match"
          description={`Nothing matches ${narrowedBy.join(" and ")}. Clear the narrowing to see the queue again.`}
          action={
            <Button size="sm" variant="outline" onClick={onClearNarrowing}>
              Clear search and filters
            </Button>
          }
          className="h-full"
        />
      );
    }
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

  const selectedIssue = issues[selectedIndex];

  return (
    <>
      {/* j/k moves the selection without moving DOM focus, so the row change is
          silent to a screen reader. This polite region is the announcement; the
          list itself stays a list rather than pretending to be a focused
          listbox that it is not. */}
      <div aria-live="polite" className="sr-only">
        {selectedIssue ? `Selected issue: ${selectedIssue.title}` : ""}
      </div>
      <div ref={parentRef} className="h-full overflow-auto" role="list" aria-label="Issue queue">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const issue = issues[virtualItem.index];
            return (
              <div
                key={virtualItem.key}
                ref={virtualizer.measureElement}
                data-index={virtualItem.index}
                role="listitem"
                aria-setsize={issues.length}
                aria-posinset={virtualItem.index + 1}
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
                  repoName={repoNames?.get(issue.repoId) ?? null}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
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
  repoName,
}: {
  issue: IssueWithTriage;
  isSelected: boolean;
  onSelect: (issue: IssueWithTriage) => void;
  isSelectedForBulk: boolean;
  onToggleSelected?: (issueId: string) => void;
  repoName?: string | null;
}) {
  const priority = issue.triage?.priority != null ? priorityLabels[issue.triage.priority] : null;

  return (
    <div className="issue-row group relative flex items-start gap-1 border-b border-border/70">
      {onToggleSelected && (
        <input
          type="checkbox"
          aria-label={`Select issue #${issue.number}`}
          // One tab stop per row (the row button). Bulk selection keeps the X
          // shortcut and the visible Select all control; the checkbox stays
          // pointer-accessible without doubling a 1,000-row tab walk.
          tabIndex={-1}
          checked={isSelectedForBulk}
          aria-checked={isSelectedForBulk}
          onClick={(event) => event.stopPropagation()}
          onChange={() => onToggleSelected(issue.id)}
          className="ml-3 mt-3 h-6 w-6 shrink-0 accent-primary"
        />
      )}
      <button
        aria-current={isSelected ? "true" : undefined}
        onClick={() => onSelect(issue)}
        className={cn(
          "issue-row-button flex min-w-0 flex-1 items-start gap-2.5 px-4 py-2.5 text-left transition-colors",
          isSelected ? "is-selected text-foreground" : "text-foreground hover:bg-muted/50"
        )}
        style={{ contentVisibility: "auto", containIntrinsicSize: "88px" }}
      >
        <CircleDot
          className={cn(
            "mt-1 h-3.5 w-3.5 shrink-0",
            issue.state === "open" ? "text-[var(--state-open)]" : "text-muted-foreground/60"
          )}
        />
        <span className="sr-only">{issue.state === "open" ? "Open issue" : "Closed issue"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            {priority && (
              <Badge
                variant="outline"
                className={cn(
                  "shrink-0 px-1.5 py-0 font-mono text-xs leading-4",
                  priority.className
                )}
              >
                {priority.label}
              </Badge>
            )}
            <span
              className="line-clamp-2 break-words text-sm font-medium leading-snug [overflow-wrap:anywhere]"
              title={issue.title}
            >
              {issue.title}
            </span>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted-foreground">
            {repoName && (
              <span className="max-w-[16rem] truncate font-mono" title={repoName}>
                {shortenRepoName(repoName)}
              </span>
            )}
            <span className="font-mono">#{issue.number}</span>
            {issue.author && (
              <span className="max-w-40 truncate" title={issue.author}>
                by {issue.author}
              </span>
            )}
            <span className="font-mono">{formatRelativeTime(issue.updatedAt)}</span>
          </div>
        </div>
      </button>
    </div>
  );
});
