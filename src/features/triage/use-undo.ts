/**
 * @module triage/use-undo
 * Provides an undo stack for triage actions and an undo toast for live mode.
 * In batch mode, undone actions are popped from a Zustand store.
 * In live mode, a toast notification with an "Undo" button is shown instead.
 */
"use client";

import { create } from "zustand";
import { toast } from "sonner";
import type { TriageAction } from "./types";

/**
 * Zustand state shape for the undo stack.
 *
 * @property stack - LIFO array of {@link TriageAction} entries.
 * @property push - Pushes a new action onto the top of the stack.
 * @property pop - Removes and returns the most recent action, or `undefined` if empty.
 * @property clear - Empties the entire undo stack.
 */
interface UndoState {
  stack: TriageAction[];
  push: (action: TriageAction) => void;
  pop: () => TriageAction | undefined;
  clear: () => void;
}

/**
 * Zustand store that manages the undo stack for batch-mode triage actions.
 * Each action pushed contains enough context (including `previousPayload`)
 * to reverse the change when the user invokes undo.
 */
export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  push: (action) => set((s) => ({ stack: [...s.stack, action] })),
  pop: () => {
    const stack = get().stack;
    if (stack.length === 0) return undefined;
    const last = stack[stack.length - 1];
    set({ stack: stack.slice(0, -1) });
    return last;
  },
  clear: () => set({ stack: [] }),
}));

/**
 * Display an undo toast notification for live-mode triage actions.
 * The toast includes an "Undo" button that fires the provided callback.
 *
 * @param description - Human-readable description of the action (shown in the toast).
 * @param onUndo - Callback invoked when the user clicks the "Undo" button.
 * @returns The Sonner toast ID, which can be used to dismiss the toast programmatically.
 */
export function showUndoToast(description: string, onUndo: () => void) {
  return toast(description, {
    duration: 5000,
    action: {
      label: "Undo",
      onClick: onUndo,
    },
  });
}
