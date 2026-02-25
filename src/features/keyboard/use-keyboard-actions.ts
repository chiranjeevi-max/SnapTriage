"use client";

import { useCallback } from "react";
import { useKeyboardStore } from "./keyboard-store";
import { useSync, type IssueWithTriage } from "@/features/inbox/use-issues";
import { useTriageMutation } from "@/features/triage/use-triage-mutation";
import { useUndoStore } from "@/features/triage/use-undo";
import { useBatchPush } from "@/features/triage/use-batch";

export function useKeyboardActions(issues: IssueWithTriage[]) {
  const {
    selectedIndex,
    moveSelection,
    toggleOverlay,
    setSelectedIndex,
    setLabelPickerOpen,
    setAssigneePickerOpen,
    setSnoozePickerOpen,
  } = useKeyboardStore();
  const triage = useTriageMutation();
  const sync = useSync();
  const batchPush = useBatchPush();
  const popUndo = useUndoStore((s) => s.pop);

  return useCallback(
    (id: string) => {
      const currentIssue = issues[selectedIndex] ?? null;

      switch (id) {
        case "move-down":
          moveSelection(1);
          break;
        case "move-up":
          moveSelection(-1);
          break;
        case "open-detail":
          if (selectedIndex < 0 && issues.length > 0) {
            setSelectedIndex(0);
          }
          break;
        case "close-detail":
          setSelectedIndex(-1);
          break;
        case "priority-0":
        case "priority-1":
        case "priority-2":
        case "priority-3": {
          if (!currentIssue) break;
          const priority = parseInt(id.split("-")[1]);
          const newPriority = currentIssue.triage?.priority === priority ? null : priority;
          const prevPriority = currentIssue.triage?.priority ?? null;
          triage.mutate({
            issueId: currentIssue.id,
            payload: { priority: newPriority },
            previousPayload: { priority: prevPriority },
            description:
              newPriority !== null ? `Set priority to P${newPriority}` : "Cleared priority",
          });
          break;
        }
        case "dismiss": {
          if (!currentIssue) break;
          const newDismissed = !currentIssue.triage?.dismissed;
          triage.mutate({
            issueId: currentIssue.id,
            payload: { dismissed: newDismissed },
            previousPayload: { dismissed: !newDismissed },
            description: newDismissed ? "Dismissed issue" : "Undismissed issue",
          });
          break;
        }
        case "labels":
          if (!currentIssue) break;
          setLabelPickerOpen(true);
          break;
        case "assignees":
          if (!currentIssue) break;
          setAssigneePickerOpen(true);
          break;
        case "snooze":
          if (!currentIssue) break;
          setSnoozePickerOpen(true);
          break;
        case "undo": {
          const action = popUndo();
          if (action) {
            triage.mutate({
              issueId: action.issueId,
              payload: action.previousPayload,
              previousPayload: action.payload,
              description: "Undid last action",
            });
          }
          break;
        }
        case "batch-push":
          batchPush.mutate();
          break;
        case "refresh":
          sync.mutate(undefined);
          break;
        case "toggle-overlay":
          toggleOverlay();
          break;
      }
    },
    [
      issues,
      selectedIndex,
      moveSelection,
      toggleOverlay,
      setSelectedIndex,
      setLabelPickerOpen,
      setAssigneePickerOpen,
      setSnoozePickerOpen,
      triage,
      sync,
      batchPush,
      popUndo,
    ]
  );
}
