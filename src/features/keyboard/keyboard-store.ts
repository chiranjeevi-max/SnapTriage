import { create } from "zustand";

interface KeyboardState {
  selectedIndex: number;
  issueCount: number;
  overlayOpen: boolean;
  labelPickerOpen: boolean;
  assigneePickerOpen: boolean;
  snoozePickerOpen: boolean;

  setSelectedIndex: (i: number) => void;
  setIssueCount: (n: number) => void;
  moveSelection: (delta: number) => void;
  toggleOverlay: () => void;
  setLabelPickerOpen: (open: boolean) => void;
  setAssigneePickerOpen: (open: boolean) => void;
  setSnoozePickerOpen: (open: boolean) => void;
  isAnyPickerOpen: () => boolean;
  reset: () => void;
}

export const useKeyboardStore = create<KeyboardState>((set, get) => ({
  selectedIndex: 0,
  issueCount: 0,
  overlayOpen: false,
  labelPickerOpen: false,
  assigneePickerOpen: false,
  snoozePickerOpen: false,

  setSelectedIndex: (i) => set({ selectedIndex: i }),

  setIssueCount: (n) =>
    set((state) => ({
      issueCount: n,
      selectedIndex: Math.min(state.selectedIndex, Math.max(0, n - 1)),
    })),

  moveSelection: (delta) =>
    set((state) => {
      if (state.issueCount === 0) return state;
      const next = state.selectedIndex + delta;
      return { selectedIndex: Math.max(0, Math.min(next, state.issueCount - 1)) };
    }),

  toggleOverlay: () => set((state) => ({ overlayOpen: !state.overlayOpen })),

  setLabelPickerOpen: (open) => set({ labelPickerOpen: open }),
  setAssigneePickerOpen: (open) => set({ assigneePickerOpen: open }),
  setSnoozePickerOpen: (open) => set({ snoozePickerOpen: open }),

  isAnyPickerOpen: () => {
    const s = get();
    return s.labelPickerOpen || s.assigneePickerOpen || s.snoozePickerOpen;
  },

  reset: () =>
    set({
      selectedIndex: 0,
      issueCount: 0,
      overlayOpen: false,
      labelPickerOpen: false,
      assigneePickerOpen: false,
      snoozePickerOpen: false,
    }),
}));
