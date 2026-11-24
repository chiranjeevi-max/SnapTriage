/**
 * @module triage/use-undo
 * Provides undo stacks for triage actions and an undo toast.
 *
 * Two stacks, because the two sync modes undo different things. A staged action
 * is reversed by merging its inverse into the pending changes; a live action
 * has already reached the provider and is reversed with another write. Every
 * entry carries the same monotonic sequence, so `z` always reverses whichever
 * action happened last, regardless of which stack holds it. The live stack is
 * what makes the shortcut work in the default live mode; the toast covers the
 * same action by id, so pressing both cannot undo twice.
 */
"use client";

import { create } from "zustand";
import { toast } from "sonner";
import type { TriageAction } from "./types";

/** A staged action with the order stamp shared by both stacks. */
export interface StagedUndoAction extends TriageAction {
  sequence: number;
}

/** A live action with the order stamp and the id its toast shares. */
export interface LiveUndoAction extends StagedUndoAction {
  id: string;
}

/** How many live actions stay available to `z`. */
const LIVE_STACK_LIMIT = 20;

let sequence = 0;
let liveSequence = 0;

/**
 * Zustand state shape for the undo stacks.
 *
 * @property stack - LIFO array of staged actions.
 * @property liveStack - LIFO array of live actions.
 * @property push - Records a staged action and returns its sequence.
 * @property pop - Removes and returns the most recent staged action.
 * @property pushLive - Records a live action and returns its id.
 * @property popLive - Removes and returns the most recent live action.
 * @property removeLive - Removes a live action by id, for the toast.
 * @property clear - Empties both stacks.
 */
interface UndoState {
  stack: StagedUndoAction[];
  liveStack: LiveUndoAction[];
  push: (action: TriageAction) => number;
  pop: () => StagedUndoAction | undefined;
  pushLive: (action: TriageAction) => string;
  popLive: () => LiveUndoAction | undefined;
  removeLive: (id: string) => LiveUndoAction | undefined;
  clear: () => void;
}

/**
 * Zustand store that manages both undo stacks.
 */
export const useUndoStore = create<UndoState>((set, get) => ({
  stack: [],
  liveStack: [],
  push: (action) => {
    const order = ++sequence;
    set((s) => ({ stack: [...s.stack, { ...action, sequence: order }] }));
    return order;
  },
  pop: () => {
    const stack = get().stack;
    if (stack.length === 0) return undefined;
    const last = stack[stack.length - 1];
    set({ stack: stack.slice(0, -1) });
    return last;
  },
  pushLive: (action) => {
    const id = `live-${++liveSequence}`;
    const order = ++sequence;
    set((s) => ({
      liveStack: [...s.liveStack, { ...action, id, sequence: order }].slice(-LIVE_STACK_LIMIT),
    }));
    return id;
  },
  popLive: () => {
    const liveStack = get().liveStack;
    if (liveStack.length === 0) return undefined;
    const last = liveStack[liveStack.length - 1];
    set({ liveStack: liveStack.slice(0, -1) });
    return last;
  },
  removeLive: (id) => {
    const liveStack = get().liveStack;
    const index = liveStack.findIndex((action) => action.id === id);
    if (index < 0) return undefined;
    const [removed] = liveStack.slice(index, index + 1);
    set({ liveStack: [...liveStack.slice(0, index), ...liveStack.slice(index + 1)] });
    return removed;
  },
  clear: () => set({ stack: [], liveStack: [] }),
}));

/**
 * Display an undo toast notification for live-mode triage actions.
 *
 * @param description - Human-readable description of the action.
 * @param onUndo - Callback invoked when the user clicks "Undo".
 * @returns The Sonner toast ID.
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
