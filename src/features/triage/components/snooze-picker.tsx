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

interface SnoozePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: IssueWithTriage | null;
  batch?: boolean;
}

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

export function SnoozePicker({ open, onOpenChange, issue, batch }: SnoozePickerProps) {
  const triage = useTriageMutation();
  const [showCustom, setShowCustom] = useState(false);
  const [customDate, setCustomDate] = useState("");

  if (!issue) return null;

  const isSnoozed = !!issue.triage?.snoozedUntil;
  const options = getSnoozeOptions();

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
