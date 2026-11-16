/**
 * @module keyboard/keyboard-store
 *
 * Zustand store for keyboard-driven UI state.
 *
 * Holds the selected issue index, issue count, overlay toggle, and picker
 * open/close flags. The store is consumed by the inbox view, keyboard shortcut
 * hooks, and triage picker components.
 */
import { create } from "zustand";

/**
 * Shape of the keyboard store state and actions.
 * State is intentionally flat for performance; Zustand selectors
 * re-render components only when their selected slice changes.
 */
interface KeyboardState {
  selectedIndex: number;
  issueCount: number;
  overlayOpen: boolean;
  labelPickerOpen: boolean;
  assigneePickerOpen: boolean;
  snoozePickerOpen: boolean;
  presetPickerOpen: boolean;
  savedReplyPickerOpen: boolean;
  followUpPanelOpen: boolean;
  /**
   * Set by the `follow-up` shortcut and consumed by the detail pane's
   * follow-up control.
   *
   * A request rather than an open flag, because arming reads the provider for a
   * baseline and that mutation lives in the pane that knows which issue is
   * selected. The consumer clears it, so it cannot fire twice.
   */
  followUpArmRequested: boolean;

  setSelectedIndex: (i: number) => void;
  setIssueCount: (n: number) => void;
  moveSelection: (delta: number) => void;
  toggleOverlay: () => void;
  setLabelPickerOpen: (open: boolean) => void;
  setAssigneePickerOpen: (open: boolean) => void;
  setSnoozePickerOpen: (open: boolean) => void;
  setPresetPickerOpen: (open: boolean) => void;
  setSavedReplyPickerOpen: (open: boolean) => void;
  setFollowUpPanelOpen: (open: boolean) => void;
  setFollowUpArmRequested: (requested: boolean) => void;
  isAnyPickerOpen: () => boolean;
  reset: () => void;
}

/** Global keyboard/UI state store. */
export const useKeyboardStore = create<KeyboardState>((set, get) => ({
  selectedIndex: 0,
  issueCount: 0,
  overlayOpen: false,
  labelPickerOpen: false,
  assigneePickerOpen: false,
  snoozePickerOpen: false,
  presetPickerOpen: false,
  savedReplyPickerOpen: false,
  followUpPanelOpen: false,
  followUpArmRequested: false,

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
  setPresetPickerOpen: (open) => set({ presetPickerOpen: open }),
  setSavedReplyPickerOpen: (open) => set({ savedReplyPickerOpen: open }),
  setFollowUpPanelOpen: (open) => set({ followUpPanelOpen: open }),
  setFollowUpArmRequested: (requested) => set({ followUpArmRequested: requested }),

  // The two dialogs that belong to the reply surface are counted here even
  // though they are not triage controls: their buttons are not editable
  // elements, so without these flags a `d` pressed while choosing a template or
  // reading follow-up details would dismiss the issue behind the dialog.
  isAnyPickerOpen: () => {
    const s = get();
    return (
      s.labelPickerOpen ||
      s.assigneePickerOpen ||
      s.snoozePickerOpen ||
      s.presetPickerOpen ||
      s.savedReplyPickerOpen ||
      s.followUpPanelOpen
    );
  },

  reset: () =>
    set({
      selectedIndex: 0,
      issueCount: 0,
      overlayOpen: false,
      labelPickerOpen: false,
      assigneePickerOpen: false,
      snoozePickerOpen: false,
      presetPickerOpen: false,
      savedReplyPickerOpen: false,
      followUpPanelOpen: false,
      followUpArmRequested: false,
    }),
}));
