/**
 * @module inbox/components/issue-detail
 *
 * Right-pane component that renders the full details of the currently selected issue.
 * Includes: header with state/number/snooze badge, priority buttons, triage action
 * buttons (dismiss, labels, assignees, snooze), label/assignee chips, and the
 * rendered Markdown body.
 */
"use client";

import Image from "next/image";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CircleDot,
  Clock,
  ExternalLink,
  MessageSquare,
  Tag,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/empty-state";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { IssueWithTriage, IssueDetail } from "@/features/inbox/use-issues";
import { useIssue } from "@/features/inbox/use-issues";
import { useTriageMutation } from "@/features/triage/use-triage-mutation";
import { priorityOptions } from "@/features/triage/priority";
import { useKeyboardStore, Kbd } from "@/features/keyboard";

interface IssueDetailProps {
  issue: IssueWithTriage | null;
  onClose: () => void;
}

/**
 * Formats a snooze expiry into remaining time (e.g., "3h", "2d").
 * @param isoStr - ISO date string for the snooze-until timestamp.
 */
function snoozeTimeLeft(isoStr: string): string {
  const diffMs = new Date(isoStr).getTime() - Date.now();
  if (diffMs <= 0) return "expired";
  const diffMins = Math.floor(diffMs / 60000);
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
export function IssueDetail({ issue: issueSummary, onClose }: IssueDetailProps) {
  const { data: issue } = useIssue(issueSummary?.id);
  const triage = useTriageMutation();
  const resolvedIssue = (issue ?? issueSummary) as IssueDetail;
  const { setLabelPickerOpen, setAssigneePickerOpen, setSnoozePickerOpen } = useKeyboardStore();

  if (!issue) {
    return (
      <EmptyState
        icon={<MessageSquare className="h-5 w-5" />}
        title="No issue selected"
        description="Move with J and K, or click a row in the list to read it here."
        className="h-full"
      />
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
    <div className="issue-detail flex h-full min-w-0 flex-col bg-card">
      {/* Header */}
      <div className="relative flex shrink-0 items-start gap-3 border-b px-6 py-6">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-9 items-center gap-2 pr-20">
            <CircleDot
              className={cn(
                "h-4 w-4 shrink-0",
                resolvedIssue.state === "open"
                  ? "text-[var(--state-open)]"
                  : "text-muted-foreground/60"
              )}
            />
            <span className="font-mono text-xs text-muted-foreground">#{issue.number}</span>
            {isSnoozed && (
              <Badge variant="secondary" className="gap-1 text-xs leading-4">
                <Clock className="h-3 w-3" />
                {snoozeTimeLeft(currentIssue.triage!.snoozedUntil!)}
              </Badge>
            )}
          </div>
          <h2 className="issue-detail-title mt-4 max-w-[40ch] font-semibold leading-snug tracking-[-0.025em]">
            {resolvedIssue.title}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {resolvedIssue.author && (
              <span className="flex min-w-0 max-w-full items-center gap-1 [overflow-wrap:anywhere]">
                {resolvedIssue.authorAvatar ? (
                  <Image
                    src={resolvedIssue.authorAvatar}
                    alt={resolvedIssue.author}
                    width={16}
                    height={16}
                    className="h-4 w-4 rounded-full"
                    unoptimized
                  />
                ) : (
                  <User className="h-3 w-3" />
                )}
                {resolvedIssue.author}
              </span>
            )}
            <span>
              opened{" "}
              {formatRelativeTime(resolvedIssue.createdAt, { suffix: true, nowLabel: "just now" })}
            </span>
            <span>
              updated{" "}
              {formatRelativeTime(resolvedIssue.updatedAt, { suffix: true, nowLabel: "just now" })}
            </span>
          </div>
        </div>
        <div className="absolute right-4 top-6 flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="icon" asChild>
            <a href={resolvedIssue.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              <span className="sr-only">Open issue on the provider</span>
            </a>
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
            <span className="sr-only">Close details</span>
          </Button>
        </div>
      </div>

      {/* Triage actions */}
      <div className="shrink-0 border-b px-6 py-4">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Priority</p>
        <div className="flex flex-wrap gap-1.5">
          {priorityOptions.map((opt) => (
            <Tooltip key={opt.value}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => handlePriority(opt.value)}
                  className={cn(
                    "h-8 rounded-md border px-2.5 text-xs font-medium transition-colors active:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
                    currentPriority === opt.value
                      ? opt.className
                      : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
                  )}
                >
                  {opt.name}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="flex items-center gap-1.5">
                <span>{opt.name}</span>
                <Kbd>{opt.key}</Kbd>
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={resolvedIssue.triage?.dismissed ? "secondary" : "outline"}
                size="sm"
                onClick={handleDismiss}
                className="h-8 gap-1.5 px-2.5 text-xs"
              >
                {resolvedIssue.triage?.dismissed ? "Undismiss" : "Dismiss"}
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
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => setLabelPickerOpen(true)}
              >
                <Tag className="h-3 w-3" />
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
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => setAssigneePickerOpen(true)}
              >
                <UserPlus className="h-3 w-3" />
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
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => setSnoozePickerOpen(true)}
              >
                <Clock className="h-3 w-3" />
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
      {(resolvedIssue.labels.length > 0 || resolvedIssue.assignees.length > 0) && (
        <div className="shrink-0 border-b px-6 py-4">
          {resolvedIssue.labels.length > 0 && (
            <div className="mb-2">
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Labels</p>
              <div className="flex flex-wrap gap-1">
                {resolvedIssue.labels.map((label) => (
                  <span
                    key={label}
                    className="max-w-full break-all rounded bg-muted px-2 py-1 text-xs leading-4 text-muted-foreground"
                  >
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
          {resolvedIssue.assignees.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Assignees</p>
              <div className="flex flex-wrap gap-1">
                {resolvedIssue.assignees.map((assignee) => (
                  <Badge
                    key={assignee}
                    variant="outline"
                    className="max-w-full whitespace-normal break-words text-xs leading-4 [overflow-wrap:anywhere]"
                  >
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
      {/* Radix wraps viewport children in a `display: table` box that sizes to
          its widest descendant, so a markdown table would widen the whole
          pane instead of scrolling inside it. Pinning that wrapper to the
          viewport width breaks the loop; `contain: inline-size` on the body
          (globals.css) keeps the same guarantee if the wrapper ever changes. */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:w-full">
        <div className="mx-auto w-full max-w-[var(--reading-width)] p-6">
          {resolvedIssue.body ? (
            <div className="issue-body">
              <Markdown remarkPlugins={[remarkGfm]}>{resolvedIssue.body}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No description provided.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
