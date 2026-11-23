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
   * The issue the `follow-up` shortcut was pressed for, or `null`.
   *
   * Carries the id rather than a boolean because the request outlives the
   * selection that produced it: a control for a different issue mounts during a
   * pane load, and a bare flag would let it arm the wrong issue. The control only
   * consumes a request naming its own issue, and clears it when it does.
   */
  followUpArmRequested: string | null;
  /**
   * A pending bulk-selection command from the keyboard, or `null`.
   *
   * A request rather than a direct write because the selection itself belongs to
   * the inbox view, which is the only place that knows which rows are visible.
   * The dispatcher knows the keystroke; the view knows the list. `toggle` names
   * the row it applies to, which is why it carries an id rather than a flag.
   */
  selectionRequest: { action: "toggle"; issueId: string } | { action: "all" } | null;

  setSelectedIndex: (i: number) => void;
  setIssueCount: (n: number | null) => void;
  moveSelection: (delta: number) => void;
  toggleOverlay: () => void;
  setLabelPickerOpen: (open: boolean) => void;
  setAssigneePickerOpen: (open: boolean) => void;
  setSnoozePickerOpen: (open: boolean) => void;
  setPresetPickerOpen: (open: boolean) => void;
  setSavedReplyPickerOpen: (open: boolean) => void;
  setFollowUpPanelOpen: (open: boolean) => void;
  setFollowUpArmRequested: (issueId: string | null) => void;
  setSelectionRequest: (request: KeyboardState["selectionRequest"]) => void;
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
  followUpArmRequested: null,
  selectionRequest: null,

  setSelectedIndex: (i) => set({ selectedIndex: i }),

  /**
   * Report the length of the list the keyboard is navigating.
   *
   * `null` means "no list on screen" rather than "an empty list". The two are
   * different: an empty queue legitimately clamps the selection to zero, while a
   * surface that is not the queue at all must leave the selection untouched so
   * returning to it restores the row the user was on. Clamping on the
   * follow-up surface would move the detail pane to row 0 and, if that pane is
   * uncached, unmount the composer with text still in it.
   */
  setIssueCount: (n) =>
    set((state) =>
      n === null
        ? { issueCount: 0 }
        : { issueCount: n, selectedIndex: Math.min(state.selectedIndex, Math.max(0, n - 1)) }
    ),

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
  setFollowUpArmRequested: (issueId) => set({ followUpArmRequested: issueId }),
  setSelectionRequest: (request) => set({ selectionRequest: request }),

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
      followUpArmRequested: null,
      selectionRequest: null,
    }),
}));
