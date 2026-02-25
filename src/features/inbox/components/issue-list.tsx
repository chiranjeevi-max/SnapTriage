"use client";

import { useEffect, useRef } from "react";
import { CircleDot, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { IssueWithTriage } from "../use-issues";

interface IssueListProps {
  issues: IssueWithTriage[];
  selectedIndex: number;
  onSelect: (issue: IssueWithTriage) => void;
  isLoading: boolean;
}

const priorityLabels: Record<number, { label: string; className: string }> = {
  0: { label: "P0", className: "bg-red-500/20 text-red-400 border-red-500/30" },
  1: { label: "P1", className: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  2: { label: "P2", className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  3: { label: "P3", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo`;
}

export function IssueList({ issues, selectedIndex, onSelect, isLoading }: IssueListProps) {
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
    <ScrollArea className="h-full">
      <div role="listbox" className="space-y-0.5 p-1">
        {issues.map((issue, index) => (
          <IssueRow
            key={issue.id}
            issue={issue}
            isSelected={index === selectedIndex}
            onSelect={() => onSelect(issue)}
          />
        ))}
      </div>
    </ScrollArea>
  );
}

function IssueRow({
  issue,
  isSelected,
  onSelect,
}: {
  issue: IssueWithTriage;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const priority = issue.triage?.priority != null ? priorityLabels[issue.triage.priority] : null;

  useEffect(() => {
    if (isSelected) {
      ref.current?.scrollIntoView({ block: "nearest" });
    }
  }, [isSelected]);

  return (
    <button
      ref={ref}
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
        isSelected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50 text-foreground"
      )}
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
          <span>{timeAgo(issue.updatedAt)}</span>
        </div>
        {issue.labels.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {issue.labels.slice(0, 3).map((label) => (
              <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0">
                {label}
              </Badge>
            ))}
            {issue.labels.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{issue.labels.length - 3}</span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}
