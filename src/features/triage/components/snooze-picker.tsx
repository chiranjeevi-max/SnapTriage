/**
 * @module triage/components/snooze-picker
 * Dialog for snoozing (or unsnoozing) an issue. Offers preset durations
 * (1 hour, tomorrow 9 AM, next Monday 9 AM) and a custom date-time picker.
 */
"use client";

import { useState } from "react";
import { Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTriageMutation } from "../use-triage-mutation";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

/**
 * Props for the {@link SnoozePicker} component.
 *
 * @property open - Whether the dialog is open.
 * @property onOpenChange - Callback to toggle the dialog open/closed.
 * @property issue - The issue to snooze/unsnooze, or `null` if none.
 * @property batch - When `true`, stages the snooze change for batch push.
 */
interface SnoozePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: IssueWithTriage | null;
  batch?: boolean;
}

/**
 * Compute the preset snooze options relative to the current time.
 *
 * @returns An array of `{ label, value }` objects where `value` is an ISO 8601 string.
 */
function getSnoozeOptions() {
  const now = new Date();

  const oneHour = new Date(now.getTime() + 60 * 60 * 1000);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const nextMonday = new Date(now);
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  nextMonday.setHours(9, 0, 0, 0);

  return [
    { label: "1 hour", value: oneHour.toISOString() },
    { label: "Tomorrow 9am", value: tomorrow.toISOString() },
    { label: "Next Monday 9am", value: nextMonday.toISOString() },
  ];
}

/**
 * Dialog component for snoozing or unsnoozing an issue.
 * Presents preset duration buttons and an optional custom date-time input.
 * Uses {@link useTriageMutation} to apply the snooze payload.
 *
 * @param props - {@link SnoozePickerProps}
 * @returns The snooze picker dialog, or `null` if no issue is provided.
 */
export function SnoozePicker({ open, onOpenChange, issue, batch }: SnoozePickerProps) {
  const triage = useTriageMutation();
  const [showCustom, setShowCustom] = useState(false);
  const [customDate, setCustomDate] = useState("");

  if (!issue) return null;

  const isSnoozed = !!issue.triage?.snoozedUntil;
  const options = getSnoozeOptions();

  /**
   * Apply a snooze with the given ISO timestamp and close the dialog.
   *
   * @param isoString - ISO 8601 date-time string for the snooze expiry.
   */
  function handleSnooze(isoString: string) {
    if (!issue) return;
    triage.mutate({
      issueId: issue.id,
      payload: { snoozedUntil: isoString },
      previousPayload: { snoozedUntil: issue.triage?.snoozedUntil ?? null },
      description: "Snoozed issue",
      batch,
    });
    onOpenChange(false);
    setShowCustom(false);
  }

  /** Remove the snooze from the issue and close the dialog. */
  function handleUnsnooze() {
    if (!issue) return;
    triage.mutate({
      issueId: issue.id,
      payload: { snoozedUntil: null },
      previousPayload: { snoozedUntil: issue.triage?.snoozedUntil ?? null },
      description: "Unsnoozed issue",
      batch,
    });
    onOpenChange(false);
  }

  /** Submit the custom date-time value as a snooze target. */
  function handleCustomSubmit() {
    if (!customDate) return;
    handleSnooze(new Date(customDate).toISOString());
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        setShowCustom(false);
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Snooze Issue
          </DialogTitle>
          <DialogDescription>Choose when to be reminded about this issue.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {isSnoozed && (
            <Button variant="outline" size="sm" onClick={handleUnsnooze}>
              Unsnooze
            </Button>
          )}

          {options.map((opt) => (
            <Button
              key={opt.label}
              variant="outline"
              size="sm"
              className="justify-start"
              onClick={() => handleSnooze(opt.value)}
            >
              {opt.label}
            </Button>
          ))}

          {!showCustom ? (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start"
              onClick={() => setShowCustom(true)}
            >
              Custom...
            </Button>
          ) : (
            <div className="flex gap-2">
              <Input
                type="datetime-local"
                value={customDate}
                onChange={(e) => setCustomDate(e.target.value)}
                className="flex-1"
              />
              <Button size="sm" onClick={handleCustomSubmit} disabled={!customDate}>
                Set
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
