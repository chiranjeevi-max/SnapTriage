/**
 * @module inbox/components/issue-detail
 *
 * Right-pane component that renders the full details of the currently selected issue.
 * Includes: header with state/number/snooze badge, priority buttons, triage action
 * buttons (dismiss, labels, assignees, snooze), label/assignee chips, and the
 * rendered Markdown body.
 */
"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CircleDot, Clock, ExternalLink, Tag, User, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { IssueWithTriage } from "../use-issues";
import { useTriageMutation } from "@/features/triage/use-triage-mutation";
import { useKeyboardStore, Kbd } from "@/features/keyboard";

interface IssueDetailProps {
  issue: IssueWithTriage | null;
  onClose: () => void;
}

/** Priority button options mapping P0-P3 to colors and keyboard shortcut keys. */
const priorityOptions = [
  {
    value: 0,
    label: "P0 Critical",
    className: "bg-red-500/20 text-red-400 border-red-500/30",
    key: "1",
  },
  {
    value: 1,
    label: "P1 High",
    className: "bg-orange-500/20 text-orange-400 border-orange-500/30",
    key: "2",
  },
  {
    value: 2,
    label: "P2 Medium",
    className: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
    key: "3",
  },
  {
    value: 3,
    label: "P3 Low",
    className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    key: "4",
  },
];

/**
 * Formats a date string into a human-readable relative time (e.g., "5m ago", "2d ago").
 * @param dateStr - ISO date string.
 */
function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo ago`;
}

/**
 * Formats a snooze expiry into remaining time (e.g., "3h", "2d").
 * @param isoStr - ISO date string for the snooze-until timestamp.
 */
function snoozeTimeLeft(isoStr: string): string {
  const diffMs = new Date(isoStr).getTime() - Date.now();
  if (diffMs <= 0) return "expired";
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 60) return `${diffMins}m`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d`;
}

/**
 * Renders the full detail view for a single issue including triage controls.
 * Shows an empty-state prompt when no issue is selected.
 */
export function IssueDetail({ issue, onClose }: IssueDetailProps) {
  const triage = useTriageMutation();
  const { setLabelPickerOpen, setAssigneePickerOpen, setSnoozePickerOpen } = useKeyboardStore();

  if (!issue) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Select an issue to view details</p>
      </div>
    );
  }

  const currentIssue = issue;
  const currentPriority = currentIssue.triage?.priority;
  const isSnoozed = !!currentIssue.triage?.snoozedUntil;

  function handlePriority(priority: number) {
    const newPriority = currentPriority === priority ? null : priority;
    triage.mutate({
      issueId: currentIssue.id,
      payload: { priority: newPriority },
      previousPayload: { priority: currentPriority ?? null },
      description: newPriority !== null ? `Set priority to P${newPriority}` : "Cleared priority",
    });
  }

  function handleDismiss() {
    const newDismissed = !currentIssue.triage?.dismissed;
    triage.mutate({
      issueId: currentIssue.id,
      payload: { dismissed: newDismissed },
      previousPayload: { dismissed: !newDismissed },
      description: newDismissed ? "Dismissed issue" : "Undismissed issue",
    });
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-start justify-between border-b p-4">
        <div className="min-w-0 flex-1 pr-2">
          <div className="flex items-center gap-2">
            <CircleDot
              className={cn(
                "h-4 w-4 shrink-0",
                issue.state === "open" ? "text-green-500" : "text-muted-foreground"
              )}
            />
            <span className="text-xs text-muted-foreground">#{issue.number}</span>
            {isSnoozed && (
              <Badge variant="secondary" className="text-xs gap-1">
                <Clock className="h-3 w-3" />
                {snoozeTimeLeft(currentIssue.triage!.snoozedUntil!)}
              </Badge>
            )}
          </div>
          <h2 className="mt-1 text-lg font-semibold leading-tight">{issue.title}</h2>
          <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
            {issue.author && (
              <span className="flex items-center gap-1">
                {issue.authorAvatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={issue.authorAvatar}
                    alt={issue.author}
                    className="h-4 w-4 rounded-full"
                  />
                ) : (
                  <User className="h-3 w-3" />
                )}
                {issue.author}
              </span>
            )}
            <span>opened {timeAgo(issue.createdAt)}</span>
            <span>updated {timeAgo(issue.updatedAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <a href={issue.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Triage actions */}
      <div className="border-b px-4 py-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Priority</p>
        <div className="flex flex-wrap gap-1.5">
          {priorityOptions.map((opt) => (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handlePriority(opt.value)}
                  className={cn(
                    "rounded-md border px-2 py-1 text-xs font-medium transition-colors",
                    currentPriority === opt.value
                      ? opt.className
                      : "border-border text-muted-foreground hover:border-foreground/20"
                  )}
                >
                  {opt.label}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-1.5">
                <span>{opt.label}</span>
                <Kbd>{opt.key}</Kbd>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={issue.triage?.dismissed ? "secondary" : "outline"}
                size="sm"
                onClick={handleDismiss}
                className="text-xs"
              >
                {issue.triage?.dismissed ? "Undismiss" : "Dismiss"}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex items-center gap-1.5">
              <span>Toggle dismiss</span>
              <Kbd>D</Kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setLabelPickerOpen(true)}
              >
                <Tag className="mr-1 h-3 w-3" />
                Labels
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex items-center gap-1.5">
              <span>Edit labels</span>
              <Kbd>L</Kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setAssigneePickerOpen(true)}
              >
                <UserPlus className="mr-1 h-3 w-3" />
                Assignees
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex items-center gap-1.5">
              <span>Edit assignees</span>
              <Kbd>A</Kbd>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setSnoozePickerOpen(true)}
              >
                <Clock className="mr-1 h-3 w-3" />
                Snooze
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex items-center gap-1.5">
              <span>Snooze issue</span>
              <Kbd>S</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Labels & Assignees */}
      {(issue.labels.length > 0 || issue.assignees.length > 0) && (
        <div className="border-b px-4 py-3">
          {issue.labels.length > 0 && (
            <div className="mb-2">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Labels</p>
              <div className="flex flex-wrap gap-1">
                {issue.labels.map((label) => (
                  <Badge key={label} variant="secondary" className="text-xs">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {issue.assignees.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Assignees</p>
              <div className="flex flex-wrap gap-1">
                {issue.assignees.map((assignee) => (
                  <Badge key={assignee} variant="outline" className="text-xs">
                    {assignee}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Separator />

      {/* Body */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {issue.body ? (
            <div className="prose prose-sm dark:prose-invert max-w-none">
              <Markdown remarkPlugins={[remarkGfm]}>{issue.body}</Markdown>
            </div>
          ) : (
            <p className="text-sm italic text-muted-foreground">No description provided.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
