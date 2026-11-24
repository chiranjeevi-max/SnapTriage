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

import { useCallback, useEffect, useRef } from "react";
import { useKeyboardStore } from "./keyboard-store";
import { useSync, type IssueWithTriage } from "@/features/inbox/use-issues";
import { useTriageMutation } from "@/features/triage/use-triage-mutation";
import { useUndoStore } from "@/features/triage/use-undo";
import { useBatchPush } from "@/features/triage/use-batch";
import { toggleIssueState } from "@/features/triage/triage-actions";

/**
 * Handlers for actions that belong to the view rather than the dispatcher.
 *
 * Bulk selection is the case: the dispatcher knows the keystroke, but only the
 * inbox view knows which rows are visible, so it hands the work back through a
 * callback instead of routing it through the shared store. A store round trip
 * would have to be consumed during render — writing to an external store there
 * is not the same as a React state update, and React rejects it.
 */
export interface KeyboardActionOptions {
  /** Add or remove one issue from the bulk selection. */
  toggleSelection?: (issueId: string) => void;
  /** Select every visible issue, or clear if they are all selected. */
  selectAllVisible?: () => void;
  /** The view opened the detail pane; on phones this is the only way it shows. */
  openDetail?: () => void;
  /** The view closed the detail pane. */
  closeDetail?: () => void;
  /** Whether undo may run when no row is selected (the queue can be emptied). */
  undoAllowed?: boolean;
}

export function useKeyboardActions(issues: IssueWithTriage[], options?: KeyboardActionOptions) {
  // Split selectors rather than one subscription: this hook lives in the inbox's
  // tree, so a selectorless form re-rendered it — and re-created the dispatcher
  // the keydown listener depends on — every time any store field moved.
  const selectedIndex = useKeyboardStore((state) => state.selectedIndex);
  const moveSelection = useKeyboardStore((state) => state.moveSelection);
  const toggleOverlay = useKeyboardStore((state) => state.toggleOverlay);
  const setSelectedIndex = useKeyboardStore((state) => state.setSelectedIndex);
  const setLabelPickerOpen = useKeyboardStore((state) => state.setLabelPickerOpen);
  const setAssigneePickerOpen = useKeyboardStore((state) => state.setAssigneePickerOpen);
  const setSnoozePickerOpen = useKeyboardStore((state) => state.setSnoozePickerOpen);
  const setPresetPickerOpen = useKeyboardStore((state) => state.setPresetPickerOpen);
  const setFollowUpArmRequested = useKeyboardStore((state) => state.setFollowUpArmRequested);
  const triage = useTriageMutation();
  const sync = useSync();
  const batchPush = useBatchPush();

  // Use refs for unstable dependencies (mutation objects that change identity each render)
  const triageRef = useRef(triage);
  const syncRef = useRef(sync);
  const batchPushRef = useRef(batchPush);
  const issuesRef = useRef(issues);
  const selectedIndexRef = useRef(selectedIndex);

  useEffect(() => {
    triageRef.current = triage;
    syncRef.current = sync;
    batchPushRef.current = batchPush;
    issuesRef.current = issues;
    selectedIndexRef.current = selectedIndex;
  });

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
          options?.openDetail?.();
          break;
        case "close-detail":
          // The view closes the pane and keeps the queue cursor; clearing the
          // selection here would send the next j/k back to row 0.
          options?.closeDetail?.();
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
            // The advance belongs to the mutation input, not to a per-call
            // callback: a newer write on the same observer replaces those.
            advanceAfterSuccess: true,
          });
          break;
        }
        case "toggle-state": {
          if (!currentIssue) break;
          // `state` is narrowed to the two values the schema accepts; any other
          // stored string is treated as open, which is the only thing a provider
          // can report besides closed.
          const { payload, previousPayload, description } = toggleIssueState(
            currentIssue.state === "closed" ? "closed" : "open"
          );
          triageRef.current.mutate({
            issueId: currentIssue.id,
            payload,
            previousPayload,
            description,
            // A closed issue leaves the open queue, so the next row is what the
            // user wants in the pane. The inbox decides whether the index has to
            // move, since the optimistic removal already shifted the list.
            advanceAfterSuccess: true,
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
        case "presets":
          setPresetPickerOpen(!!currentIssue);
          break;
        case "follow-up":
          // A request flag, not a direct mutation: the control that owns the
          // issue's follow-up state arms it when it sees the flag, so this
          // dispatcher never needs the issue id or a TanStack mutation.
          if (!currentIssue) break;
          setFollowUpArmRequested(currentIssue?.id ?? null);
          break;
        case "undo": {
          // Undo reverses an action on a queue row, and that row is not on screen
          // while the follow-up surface is up. Popping either stack there would
          // undo something the user cannot see and cannot connect to the gesture.
          // On the queue, the last row may have just left, which leaves no
          // current issue; the undo is still reversible.
          if (!currentIssue && !options?.undoAllowed) break;
          const { stack, liveStack, pop, popLive } = useUndoStore.getState();
          const staged = stack[stack.length - 1];
          const live = liveStack[liveStack.length - 1];

          // Both stacks share one sequence, so the newest action is undone
          // whichever mode recorded it.
          if (staged && (!live || staged.sequence > live.sequence)) {
            pop();
            triageRef.current.mutate({
              issueId: staged.issueId,
              payload: staged.previousPayload,
              previousPayload: staged.payload,
              description: "Undid staged change",
              // The staged stack only holds staged actions. Writing the reversal
              // live would apply the inverse to the provider while leaving the
              // staged change in place, so the next push would send the original.
              batch: true,
              undo: true,
            });
          } else if (live) {
            popLive();
            triageRef.current.mutate({
              issueId: live.issueId,
              payload: live.previousPayload,
              previousPayload: live.payload,
              description: "Undid last action",
              undo: true,
            });
          }
          break;
        }
        case "select-toggle":
          if (!currentIssue) break;
          options?.toggleSelection?.(currentIssue.id);
          break;
        case "select-all":
          options?.selectAllVisible?.();
          break;
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
      setPresetPickerOpen,
      setFollowUpArmRequested,
      options,
    ]
  );
}
