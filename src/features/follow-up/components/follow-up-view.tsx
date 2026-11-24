/**
 * @module follow-up/components/follow-up-view
 *
 * The follow-up queue: issues the user asked to be told about, and why.
 *
 * This is a separate surface from the issue queue on purpose. A follow-up is
 * cross-state — an issue that was dismissed, closed, or snoozed can still have
 * something new in it — so folding it into `issue-filters.ts` would either hide
 * the very rows the feature exists to show or break `matchesIssueFilter`, which
 * is pure and unit-tested against five fixed values.
 *
 * Freshness is the reason this view looks the way it does. Nothing polls: there
 * is no scheduler, and a check runs only when this view opens. Rather than let
 * the list imply live monitoring, it states when it was last checked, and says
 * outright when an issue has never been checked. Each row carries its own stamp,
 * because a bounded check pass can skip an issue and leave its result older than
 * the rest.
 */
"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle, BellRing, Clock3, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { cn, formatRelativeTime } from "@/lib/utils";
import { describeFollowUpReason } from "@/features/follow-up/detection";
import {
  useCheckFollowUps,
  useFollowUpAction,
  useFollowUps,
  type FollowUpEntry,
} from "@/features/follow-up/use-follow-ups";

/** The state word shown next to each row. */
const STATE_LABELS: Record<FollowUpEntry["state"], string> = {
  waiting: "Waiting",
  reviewed: "Reviewed",
  stopped: "Stopped",
};

/** One entry, with the two transitions that make sense for its current state. */
function FollowUpRow({
  entry,
  onOpenIssue,
}: {
  entry: FollowUpEntry;
  onOpenIssue: (entry: FollowUpEntry) => void;
}) {
  const action = useFollowUpAction(entry.issueId);
  const waiting = entry.state === "waiting";
  // A reviewed or stopped row has no live reason, and
  // `describeFollowUpReason(null)` reports "Waiting" — which would be false for
  // both. The reason is only meaningful while the issue is still being watched.
  const label = waiting ? describeFollowUpReason(entry.reason) : STATE_LABELS[entry.state];

  return (
    <li className="border-b border-border/70">
      <div className="flex min-w-0 items-start gap-3 px-4 py-3">
        <BellRing
          className={cn(
            "mt-0.5 h-3.5 w-3.5 shrink-0",
            entry.due ? "text-foreground" : "text-muted-foreground/60"
          )}
        />

        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenIssue(entry)}
            className="block w-full min-w-0 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <span className="line-clamp-2 break-words text-sm font-medium leading-relaxed [overflow-wrap:anywhere]">
              {entry.title}
            </span>
          </button>

          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span className="font-mono">#{entry.number}</span>
            <span className="min-w-0 break-all font-mono">{entry.fullName}</span>
          </div>

          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
            <Badge variant={entry.due ? "secondary" : "outline"} className="text-[11px] leading-4">
              {label}
            </Badge>
            {waiting && entry.reason && (
              <span className="text-[11px] text-muted-foreground">{STATE_LABELS.waiting}</span>
            )}
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {entry.checkedAt
                ? `checked ${formatRelativeTime(entry.checkedAt, { suffix: true })}`
                : "never checked"}
            </span>
          </div>

          {action.error && (
            <p role="alert" className="mt-1.5 break-words text-xs text-destructive">
              {action.error.message}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              disabled={!waiting || action.isPending}
              onClick={() =>
                // The triggering comment is not part of the list payload, so a
                // review from here records "I looked" without moving the
                // watermark. A caller that does know the comment passes it.
                action.mutate({ action: "review" })
              }
            >
              Review
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2.5 text-xs text-muted-foreground"
              disabled={!waiting || action.isPending}
              onClick={() => action.mutate({ action: "stop" })}
            >
              Stop
            </Button>
            {!waiting && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2.5 text-xs"
                disabled={action.isPending}
                onClick={() => action.mutate({ action: "wait" })}
              >
                Wait again
              </Button>
            )}
            <Button asChild variant="link" size="sm" className="ml-auto h-8 px-0 text-xs">
              <a href={entry.url} target="_blank" rel="noopener noreferrer">
                Provider
              </a>
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

interface FollowUpViewProps {
  /** Opens the issue in the detail pane. */
  onOpenIssue: (entry: FollowUpEntry) => void;
}

/**
 * The follow-up queue, with one check pass on mount.
 *
 * @param props - {@link FollowUpViewProps}
 */
export function FollowUpView({ onOpenIssue }: FollowUpViewProps) {
  const { data, isPending, isError, error, refetch } = useFollowUps();
  const check = useCheckFollowUps();

  // One pass per mount, not one per render and not on a timer. The server
  // applies its own cooldown, so a reload is cheap; a scheduled re-check would
  // promise monitoring this app does not do.
  const checkedOnMount = useRef(false);
  useEffect(() => {
    if (checkedOnMount.current) return;
    checkedOnMount.current = true;
    check.mutate();
  }, [check]);

  const entries = data?.entries ?? [];

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label="Follow-up queue">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-4 py-2.5">
        <div className="min-w-0">
          <p className="text-xs font-medium">
            Follow-ups
            {data && (
              <span className="ml-1.5 font-mono tabular-nums text-muted-foreground">
                {entries.length}
              </span>
            )}
          </p>
          <p className="mt-0.5 break-words text-[11px] leading-relaxed text-muted-foreground">
            {data?.checkedAt === null
              ? "Not checked yet. Waiting issues are read from the provider the next time you check."
              : data?.checkedAt
                ? `Last checked ${formatRelativeTime(data.checkedAt, { suffix: true })}. Checks run when you open this view, never in the background.`
                : "Checks run when you open this view, never in the background."}
          </p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1.5 px-2 text-xs"
          disabled={check.isPending}
          onClick={() => check.mutate()}
        >
          <RefreshCw className={cn("h-3 w-3", check.isPending && "animate-spin")} />
          Check now
        </Button>
      </div>

      {/* A failed check is reported on its own line rather than replacing the
          list. The GET may have succeeded and the POST may have failed, in which
          case the rows are still valid and only their freshness is in doubt. */}
      {check.isError && (
        <div
          role="alert"
          className="mx-4 mt-2 flex items-start gap-2 rounded-md border border-dashed px-3 py-2"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <p className="break-words text-xs leading-relaxed text-destructive">
              {check.error.message}
            </p>
            <Button
              variant="link"
              size="sm"
              className="h-auto p-0 text-xs"
              disabled={check.isPending}
              onClick={() => check.mutate()}
            >
              Try again
            </Button>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isPending ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <div key={index} className="flex flex-col gap-2">
                <Skeleton className="h-4 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div role="alert" className="m-4 rounded-md border border-dashed px-3 py-3">
            <p className="flex items-start gap-2 break-words text-xs leading-relaxed text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {error.message}
            </p>
            <Button
              variant="link"
              size="sm"
              className="mt-1 h-auto p-0 text-xs"
              onClick={() => refetch()}
            >
              Try again
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={<BellRing className="h-5 w-5" />}
            title="Nothing is being followed yet"
            description="Open an issue and choose Wait when you need a reply before you come back to it. It returns here when somebody answers."
            className="h-full"
          />
        ) : (
          <ul>
            {entries.map((entry) => (
              <FollowUpRow key={entry.issueId} entry={entry} onOpenIssue={onOpenIssue} />
            ))}
          </ul>
        )}
      </div>

      <div className="flex shrink-0 items-start gap-2 border-t px-4 py-2">
        <Clock3 className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
        <p className="min-w-0 break-words text-[11px] leading-relaxed text-muted-foreground">
          A follow-up is separate from snooze. Snoozing an issue does not stop it coming back here,
          and reviewing it here does not un-snooze it.
        </p>
      </div>
    </section>
  );
}
