"use client";

import { create } from "zustand";
import { toast } from "sonner";
import type { TriageAction } from "./types";

/** Undo stack for batch mode — stored in Zustand */
interface UndoState {
  stack: TriageAction[];
  push: (action: TriageAction) => void;
  pop: () => TriageAction | undefined;
  clear: () => void;
}

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

/** Show an undo toast for live mode. Returns the toast ID. */
export function showUndoToast(description: string, onUndo: () => void) {
  return toast(description, {
    duration: 5000,
    action: {
      label: "Undo",
      onClick: onUndo,
    },
  });
}
