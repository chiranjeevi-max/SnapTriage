/**
 * @module follow-up/components/follow-up-control
 *
 * The "Wait for a reply" control in the issue pane.
 *
 * A follow-up is not triage. Snooze hides an issue until a clock runs out;
 * a follow-up leaves the issue exactly where it is and watches it for activity
 * that is worth interrupting for. The two are therefore independent, and this
 * control never touches `triage_state` nor is it cleared by it.
 *
 * Arming records a baseline by reading the provider's newest comment, so the
 * first check compares against what the user could see at that moment rather
 * than against an empty thread.
 */
"use client";

import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatRelativeTime } from "@/lib/utils";
import { Kbd, useKeyboardStore } from "@/features/keyboard";
import { describeFollowUpReason } from "@/features/follow-up/detection";
import { useFollowUpAction, useFollowUps } from "@/features/follow-up/use-follow-ups";

/** The word shown on the button for each stored state. */
const STATE_LABEL: Record<"waiting" | "reviewed" | "stopped", string> = {
  waiting: "Waiting",
  reviewed: "Reviewed",
  stopped: "Stopped",
};

/**
 * Arms a follow-up for the selected issue, or shows the one already there.
 *
 * @param props - `issueId` of the issue in the detail pane.
 */
export function FollowUpControl({ issueId }: { issueId: string }) {
  const { data, isPending, isError } = useFollowUps();
  const action = useFollowUpAction(issueId);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const armRequested = useKeyboardStore((state) => state.followUpArmRequested);
  const setArmRequested = useKeyboardStore((state) => state.setFollowUpArmRequested);
  const setPanelOpen = useKeyboardStore((state) => state.setFollowUpPanelOpen);
  const arm = action.mutate;

  // The shortcut records which issue it was pressed for rather than reaching into
  // this component. Only a request naming this control's issue is acted on: the
  // request can outlive the selection that made it, and a bare flag would let a
  // control for a different issue consume it and arm the wrong one. The request
  // is cleared before the mutation starts, so a failed arm cannot re-fire.
  const entry = data?.entries.find((item) => item.issueId === issueId) ?? null;
  const state = entry?.state ?? null;

  useEffect(() => {
    if (armRequested === null) return;
    setArmRequested(null);
    if (armRequested !== issueId) return;

    // Re-arming clears the baseline and the reason, which would silently dismiss
    // a resurface the user has not read. When one already exists the key opens
    // the details, which is derived below rather than set here: re-reading the
    // baseline is an explicit button in that dialog.
    if (entry === null) arm({ action: "wait" });
  }, [armRequested, issueId, entry, setArmRequested, arm]);

  /**
   * Whether the details dialog is open.
   *
   * Opening is derived from the request rather than mirrored into state, so the
   * `w` key can open it without an effect setting state on every render. The
   * user's own clicks still control `detailsOpen`.
   */
  const showDetails = detailsOpen || (armRequested === issueId && entry !== null);

  // The details dialog is a dialog with plain buttons, so the global shortcut
  // listener needs to be told it is open; otherwise `d` would dismiss the issue
  // behind it. The flag is released on unmount as well as on close.
  useEffect(() => {
    setPanelOpen(showDetails);
    return () => setPanelOpen(false);
  }, [showDetails, setPanelOpen]);

  function handleClick() {
    // Arming before the list has loaded would issue a write while the control
    // cannot yet say whether a follow-up already exists, and a failed list read
    // would present every issue as unfollowed.
    if (isPending || isError) return;
    if (state === null) {
      action.mutate({ action: "wait" });
      return;
    }
    setDetailsOpen(true);
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={state === "waiting" ? "secondary" : "outline"}
            size="sm"
            className="h-8 gap-1.5 px-2.5 text-xs"
            disabled={action.isPending || isPending || isError}
            onClick={handleClick}
          >
            <BellRing
              className={cn(
                "h-3 w-3",
                entry?.due && "text-foreground",
                !entry && "text-muted-foreground"
              )}
            />
            {state
              ? entry?.due
                ? describeFollowUpReason(entry.reason)
                : STATE_LABEL[state]
              : "Wait"}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="flex items-center gap-1.5">
          <span>{state ? "Follow-up details" : "Wait for a reply"}</span>
          <Kbd>W</Kbd>
        </TooltipContent>
      </Tooltip>

      <Dialog open={showDetails} onOpenChange={setDetailsOpen}>
        <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-4 sm:max-w-sm">
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle className="flex items-center gap-2">
              <BellRing className="h-4 w-4" />
              Follow-up
            </DialogTitle>
            <DialogDescription>
              This issue comes back to the follow-up queue when somebody else replies, or when it is
              reopened. Reviewing or stopping it ends the watch; the row stays in the queue so you
              can see what happened, and Wait again re-arms it.
            </DialogDescription>
          </DialogHeader>

          {entry && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
              <dt className="text-muted-foreground">State</dt>
              <dd>
                <Badge variant={entry.due ? "secondary" : "outline"} className="text-[11px]">
                  {STATE_LABEL[entry.state]}
                </Badge>
              </dd>
              <dt className="text-muted-foreground">Reason</dt>
              <dd className="min-w-0 break-words">{describeFollowUpReason(entry.reason)}</dd>
              <dt className="text-muted-foreground">Checked</dt>
              <dd className="font-mono tabular-nums">
                {entry.checkedAt
                  ? formatRelativeTime(entry.checkedAt, { suffix: true })
                  : "never checked"}
              </dd>
            </dl>
          )}

          {action.error && (
            <p role="alert" className="break-words text-xs text-destructive">
              {action.error.message}
            </p>
          )}

          <p className="text-xs leading-relaxed text-muted-foreground">
            Snooze and follow-up are separate: snoozing this issue does not stop it returning here,
            and reviewing it here does not un-snooze it.
          </p>

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-9 px-2.5 text-xs"
              disabled={action.isPending || isPending || isError}
              onClick={() => action.mutate({ action: "wait" })}
            >
              {entry?.state === "waiting" ? "Re-read the baseline" : "Wait again"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2.5 text-xs"
              disabled={action.isPending || entry?.state !== "waiting"}
              onClick={() => action.mutate({ action: "review" })}
            >
              Review
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2.5 text-xs text-muted-foreground"
              disabled={action.isPending || !entry}
              onClick={() => action.mutate({ action: "stop" })}
            >
              Stop
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
