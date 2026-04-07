/**
 * @module keyboard/use-keyboard-actions
 *
 * Maps shortcut IDs to concrete triage and navigation actions.
 *
 * Returns a memoized callback `(shortcutId: string) => void` that dispatches
 * to the appropriate store action, triage mutation, or sync trigger based
 * on the matched shortcut.
 *
 * Uses refs for unstable dependencies (mutation objects) to avoid
 * re-creating the callback on every render.
 */
"use client";

import { useCallback, useRef } from "react";
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

  // Use refs for unstable dependencies (mutation objects that change identity each render)
  const triageRef = useRef(triage);
  triageRef.current = triage;
  const syncRef = useRef(sync);
  syncRef.current = sync;
  const batchPushRef = useRef(batchPush);
  batchPushRef.current = batchPush;
  const issuesRef = useRef(issues);
  issuesRef.current = issues;
  const selectedIndexRef = useRef(selectedIndex);
  selectedIndexRef.current = selectedIndex;

  return useCallback(
    (id: string) => {
      const currentIssue = issuesRef.current[selectedIndexRef.current] ?? null;

      switch (id) {
        case "move-down":
          moveSelection(1);
          break;
        case "move-up":
          moveSelection(-1);
          break;
        case "open-detail":
          if (selectedIndexRef.current < 0 && issuesRef.current.length > 0) {
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
          triageRef.current.mutate({
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
          triageRef.current.mutate({
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
            triageRef.current.mutate({
              issueId: action.issueId,
              payload: action.previousPayload,
              previousPayload: action.payload,
              description: "Undid last action",
            });
          }
          break;
        }
        case "batch-push":
          batchPushRef.current.mutate();
          break;
        case "refresh":
          syncRef.current.mutate(undefined);
          break;
        case "toggle-overlay":
          toggleOverlay();
          break;
      }
    },
    [
      moveSelection,
      toggleOverlay,
      setSelectedIndex,
      setLabelPickerOpen,
      setAssigneePickerOpen,
      setSnoozePickerOpen,
      popUndo,
    ]
  );
}
