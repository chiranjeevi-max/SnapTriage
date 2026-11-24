/**
 * @module inbox/components/issue-detail
 *
 * Right-pane component that renders the full details of the currently selected issue.
 * Includes: header with state/number/snooze badge, priority buttons, triage action
 * buttons (dismiss, labels, assignees, snooze, follow-up, presets), label/assignee
 * chips, the rendered Markdown body, the discussion, and the reply composer.
 */
"use client";

import { useEffect } from "react";
import Image from "next/image";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  CircleDot,
  Clock,
  ExternalLink,
  Layers,
  MessageSquare,
  MoreHorizontal,
  Tag,
  User,
  UserPlus,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SelectField } from "@/components/select-field";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState } from "@/components/empty-state";
import { cn, formatRelativeTime } from "@/lib/utils";
import type { IssueWithTriage, IssueDetail } from "@/features/inbox/use-issues";
import { useIssue } from "@/features/inbox/use-issues";
import { useTriageMutation } from "@/features/triage/use-triage-mutation";
import { priorityOptions } from "@/features/triage/priority";
import { shortenRepoName } from "@/features/repos/repo-label";
import { toggleIssueState } from "@/features/triage/triage-actions";
import { useKeyboardStore, Kbd } from "@/features/keyboard";
import { Discussion, Composer } from "@/features/replies";
import { FollowUpControl } from "@/features/follow-up";

/**
 * The least the pane needs to start: an issue id.
 *
 * `IssueDetail` loads the full issue by id, so a queue row is a convenience, not
 * a requirement. A follow-up on a closed issue has no queue row at all, and this
 * is what lets it open in the pane instead of resolving to nothing.
 */
export type IssueDetailTarget = Pick<IssueWithTriage, "id"> &
  Partial<Pick<IssueWithTriage, "repoId" | "provider" | "url" | "number" | "title">>;

interface IssueDetailProps {
  issue: IssueDetailTarget | null;
  onClose: () => void;
  /**
   * Repository id → full name, so the pane can say which repository the issue is
   * from. The queue already loads this list for the sidebar and the rows.
   */
  repoNames?: ReadonlyMap<string, string>;
  /** What the empty pane should say, which depends on why the queue is empty. */
  emptyTitle?: string;
  emptyDescription?: string;
  /** The pane's triage row is inert while Follow-ups owns the queue. */
  triagePaused?: boolean;
  /**
   * Whether the queue row for this issue is on screen.
   *
   * The detail pane also renders a pinned follow-up, which is not a queue row:
   * the keyboard dispatcher has no current issue then, so a shortcut hint would
   * promise something that cannot fire.
   */
  shortcutTarget?: boolean;
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
export function IssueDetail({
  issue: issueSummary,
  onClose,
  repoNames,
  emptyTitle,
  emptyDescription,
  triagePaused = false,
  shortcutTarget = true,
}: IssueDetailProps) {
  const { data: issue } = useIssue(issueSummary?.id);
  const triage = useTriageMutation();
  const resolvedIssue = (issue ?? issueSummary) as IssueDetail;
  const {
    setLabelPickerOpen,
    setAssigneePickerOpen,
    setSnoozePickerOpen,
    setPresetPickerOpen,
    setTriageMenuOpen,
    requestAdvance,
  } = useKeyboardStore();

  // The flag has to be released if the pane unmounts while the menu is open,
  // or every later shortcut would stay muted for the session.
  useEffect(() => () => setTriageMenuOpen(false), [setTriageMenuOpen]);

  if (!issue) {
    return (
      <EmptyState
        icon={<MessageSquare className="h-5 w-5" />}
        title={emptyTitle ?? "No issue selected"}
        description={emptyDescription ?? "Select a row in the queue to read it here."}
        className="h-full"
      />
    );
  }

  const currentIssue = issue;
  const repoName = repoNames?.get(currentIssue.repoId) ?? null;
  const currentPriority = currentIssue.triage?.priority;
  const isSnoozed = !!currentIssue.triage?.snoozedUntil;

  function handlePriority(priority: number | null) {
    triage.mutate({
      issueId: currentIssue.id,
      payload: { priority },
      previousPayload: { priority: currentPriority ?? null },
      description: priority !== null ? `Set priority to P${priority}` : "Cleared priority",
    });
  }

  function handleDismiss() {
    const newDismissed = !currentIssue.triage?.dismissed;
    triage.mutate(
      {
        issueId: currentIssue.id,
        payload: { dismissed: newDismissed },
        previousPayload: { dismissed: !newDismissed },
        description: newDismissed ? "Dismissed issue" : "Undismissed issue",
      },
      { onSuccess: () => requestAdvance(currentIssue.id) }
    );
  }

  function handleToggleState() {
    triage.mutate(
      {
        issueId: currentIssue.id,
        ...toggleIssueState(currentIssue.state === "closed" ? "closed" : "open"),
      },
      { onSuccess: () => requestAdvance(currentIssue.id) }
    );
  }

  return (
    <div className="issue-detail flex h-full min-w-0 flex-col bg-card">
      {/* Header */}
      <div className="relative flex shrink-0 items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex min-h-0 items-center gap-2 pr-20">
            <CircleDot
              className={cn(
                "h-4 w-4 shrink-0",
                resolvedIssue.state === "open"
                  ? "text-[var(--state-open)]"
                  : "text-muted-foreground/60"
              )}
            />
            <span className="sr-only">
              {resolvedIssue.state === "open" ? "Open issue" : "Closed issue"}
            </span>
            <span className="font-mono text-xs text-muted-foreground">#{issue.number}</span>
            {repoName && (
              <span
                className="min-w-0 max-w-[26rem] truncate font-mono text-xs text-muted-foreground"
                title={repoName}
              >
                {shortenRepoName(repoName, 56)}
              </span>
            )}
            {isSnoozed && (
              <Badge variant="secondary" className="gap-1 text-xs leading-4">
                <Clock className="h-3 w-3" />
                {snoozeTimeLeft(currentIssue.triage!.snoozedUntil!)}
              </Badge>
            )}
          </div>
          {/* Clamped, not truncated: the full title stays in the DOM and in the
              tooltip, while the description keeps the height a six-line title
              used to take. */}
          <h2
            className="issue-detail-title mt-2 line-clamp-2 max-w-[52ch] font-semibold leading-snug tracking-[-0.025em]"
            title={resolvedIssue.title}
          >
            {resolvedIssue.title}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
        <div className="absolute right-4 top-4 flex shrink-0 items-center gap-1">
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

      {/* Triage actions. The queue shortcuts are paused while Follow-ups is open,
          so the pane's controls pause with them rather than staying live on an
          issue the keyboard cannot reach. */}
      {triagePaused ? (
        <div className="shrink-0 border-b px-5 py-3 text-xs leading-relaxed text-muted-foreground">
          Triage is paused while Follow-ups is open. Close Follow-ups to act on this issue.
        </div>
      ) : (
        <div className="detail-actions shrink-0 border-b px-5 py-2.5">
          <div className="flex flex-wrap items-center gap-1">
            <SelectField
              aria-label="Priority"
              value={currentPriority ?? ""}
              onChange={(event) => {
                const value = event.target.value;
                handlePriority(value === "" ? null : Number(value));
              }}
              className="h-8 min-w-[7.5rem] px-2 text-xs"
            >
              <option value="">No priority</option>
              {priorityOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.name} ({opt.key})
                </option>
              ))}
            </SelectField>
            {/* The actions wrap as one group. Left as siblings, a narrow pane
              stranded only "More" on a second line; together they either fit or
              move as a unit. The priority select is bordered, so the row needs
              no divider — a vertical rule at the start of a wrapped line read as
              a stray border. */}
            <div className="flex flex-wrap items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant={resolvedIssue.triage?.dismissed ? "secondary" : "outline"}
                    size="sm"
                    onClick={handleDismiss}
                    className="h-8 gap-1.5 px-2 text-xs"
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
                    variant={resolvedIssue.state === "closed" ? "secondary" : "outline"}
                    size="sm"
                    onClick={handleToggleState}
                    className="h-8 gap-1.5 px-2 text-xs"
                  >
                    {resolvedIssue.state === "closed" ? "Reopen" : "Close"}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="flex items-center gap-1.5">
                  <span>{resolvedIssue.state === "closed" ? "Reopen issue" : "Close issue"}</span>
                  {/* A pinned follow-up has no queue row, so the keyboard dispatcher
                  has no current issue and `c` does nothing there. Showing the
                  hint would promise a shortcut that cannot fire. */}
                  {shortcutTarget && <Kbd>C</Kbd>}
                </TooltipContent>
              </Tooltip>

              {/* Deliberately not a snooze variant: waiting for a reply is an
              explicit state that survives a snooze expiring, and it is what the
              follow-up queue lists. */}
              <FollowUpControl issueId={issue.id} />

              {/* The four remaining triage actions share one entry point. Seven
              equal-weight buttons made the pane look like a toolbar and pushed
              the description out of the viewport; the menu keeps every action
              and its shortcut one click away. */}
              <DropdownMenu onOpenChange={setTriageMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 px-2 text-xs">
                    <MoreHorizontal className="h-3.5 w-3.5" />
                    More
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <DropdownMenuItem onSelect={() => setLabelPickerOpen(true)}>
                    <Tag className="h-3.5 w-3.5" />
                    Edit labels
                    <Kbd className="ml-auto">L</Kbd>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAssigneePickerOpen(true)}>
                    <UserPlus className="h-3.5 w-3.5" />
                    Edit assignees
                    <Kbd className="ml-auto">A</Kbd>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setSnoozePickerOpen(true)}>
                    <Clock className="h-3.5 w-3.5" />
                    Snooze for later
                    <Kbd className="ml-auto">S</Kbd>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPresetPickerOpen(true)}>
                    <Layers className="h-3.5 w-3.5" />
                    Apply a preset
                    <Kbd className="ml-auto">T</Kbd>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      )}

      {/* Labels & Assignees, one line each. A hundred labels are real data, but
          they cannot be allowed to push the description out of the pane; the
          overflow opens the picker that lists them all. */}
      {(resolvedIssue.labels.length > 0 || resolvedIssue.assignees.length > 0) && (
        <div className="flex shrink-0 flex-col gap-1.5 border-b px-5 py-2">
          {resolvedIssue.labels.length > 0 && (
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="shrink-0 text-xs font-medium text-muted-foreground">Labels</h3>
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {resolvedIssue.labels.slice(0, 4).map((label) => (
                  <span
                    key={label}
                    className="max-w-[12rem] shrink truncate rounded bg-muted px-2 py-0.5 text-xs leading-4 text-muted-foreground"
                    title={label}
                  >
                    {label}
                  </span>
                ))}
                {resolvedIssue.labels.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setLabelPickerOpen(true)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs leading-4 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  >
                    +{resolvedIssue.labels.length - 4} more
                  </button>
                )}
              </div>
            </div>
          )}
          {resolvedIssue.assignees.length > 0 && (
            <div className="flex min-w-0 items-center gap-2">
              <h3 className="shrink-0 text-xs font-medium text-muted-foreground">Assignees</h3>
              <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
                {resolvedIssue.assignees.slice(0, 4).map((assignee) => (
                  <Badge
                    key={assignee}
                    variant="outline"
                    className="max-w-[10rem] shrink justify-start truncate text-xs leading-4"
                    title={assignee}
                  >
                    {assignee}
                  </Badge>
                ))}
                {resolvedIssue.assignees.length > 4 && (
                  <button
                    type="button"
                    onClick={() => setAssigneePickerOpen(true)}
                    className="shrink-0 rounded px-1.5 py-0.5 text-xs leading-4 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
                  >
                    +{resolvedIssue.assignees.length - 4} more
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <Separator />

      {/* Body and discussion share one scroll column. Splitting them into two
          scroll regions made the discussion the only shrinkable child, so a
          short pane or the expanded composer squeezed the thread to 1px. The
          column scrolls; the composer below it stays pinned. */}
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
        {/* Keyed by issue so switching rows remounts the thread. */}
        <Discussion key={issue.id} issueId={issue.id} providerUrl={resolvedIssue.url} embedded />
      </ScrollArea>
      {/* Keyed by issue so switching rows remounts the composer. Without it,
          every piece of local state (typed text, conflict banner, the
          unconfirmed-send latch) survives the switch and would autosave to, or
          publish on, an issue the user never wrote it for. */}
      <Composer
        key={issue.id}
        issue={{ id: issue.id, url: resolvedIssue.url, provider: issue.provider }}
        className="shrink-0"
      />
    </div>
  );
}
