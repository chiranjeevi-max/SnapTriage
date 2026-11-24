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
  /**
   * Whether the reading pane shows its issue.
   *
   * Separate from the selection so closing the pane keeps the queue cursor.
   * `j`/`k`, selecting a row, or pressing Enter reopens it; repositioning after
   * a filter or sort, and the advance after triage, move the cursor without
   * reopening. Closing only changes this flag.
   */
  detailOpen: boolean;
  overlayOpen: boolean;
  labelPickerOpen: boolean;
  assigneePickerOpen: boolean;
  snoozePickerOpen: boolean;
  presetPickerOpen: boolean;
  savedReplyPickerOpen: boolean;
  followUpPanelOpen: boolean;
  /**
   * Whether the detail pane's triage menu is open.
   *
   * A dropdown is not an editable element and Radix does not trap focus the
   * way a dialog does, so without this flag a `d` pressed while choosing
   * "Snooze" would dismiss the issue behind the menu.
   */
  triageMenuOpen: boolean;
  /** Whether the bulk-dismiss confirmation is open. */
  bulkConfirmOpen: boolean;
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
   * The issue an action just settled on, waiting for the queue to advance past it.
   *
   * The list decides whether advancing is right: a dismissed row in the All
   * filter stays put, so the cursor must move; a closed row leaves the queue, so
   * the next row already holds the index and moving would skip it. The action
   * cannot know which, because the optimistic update lands before the mutation
   * settles. The inbox resolves the request against the list it renders.
   */
  advanceFromIssueId: string | null;
  requestAdvance: (issueId: string) => void;
  clearAdvance: () => void;
  setSelectedIndex: (i: number) => void;
  setIssueCount: (n: number | null) => void;
  moveSelection: (delta: number, options?: { openDetail?: boolean }) => void;
  setDetailOpen: (open: boolean) => void;
  toggleOverlay: () => void;
  setLabelPickerOpen: (open: boolean) => void;
  setAssigneePickerOpen: (open: boolean) => void;
  setSnoozePickerOpen: (open: boolean) => void;
  setPresetPickerOpen: (open: boolean) => void;
  setSavedReplyPickerOpen: (open: boolean) => void;
  setFollowUpPanelOpen: (open: boolean) => void;
  setTriageMenuOpen: (open: boolean) => void;
  setBulkConfirmOpen: (open: boolean) => void;
  setFollowUpArmRequested: (issueId: string | null) => void;
  isAnyPickerOpen: () => boolean;
  reset: () => void;
}

/** Global keyboard/UI state store. */
export const useKeyboardStore = create<KeyboardState>((set, get) => ({
  selectedIndex: 0,
  issueCount: 0,
  detailOpen: true,
  overlayOpen: false,
  labelPickerOpen: false,
  assigneePickerOpen: false,
  snoozePickerOpen: false,
  presetPickerOpen: false,
  savedReplyPickerOpen: false,
  followUpPanelOpen: false,
  triageMenuOpen: false,
  bulkConfirmOpen: false,
  followUpArmRequested: null,
  advanceFromIssueId: null,

  setSelectedIndex: (i) => set({ selectedIndex: i }),
  setDetailOpen: (open) => set({ detailOpen: open }),

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

  moveSelection: (delta, options) =>
    set((state) => {
      if (state.issueCount === 0) return state;
      const next = state.selectedIndex + delta;
      return {
        selectedIndex: Math.max(0, Math.min(next, state.issueCount - 1)),
        ...(options?.openDetail === false ? {} : { detailOpen: true }),
      };
    }),

  toggleOverlay: () => set((state) => ({ overlayOpen: !state.overlayOpen })),

  setLabelPickerOpen: (open) => set({ labelPickerOpen: open }),
  setAssigneePickerOpen: (open) => set({ assigneePickerOpen: open }),
  setSnoozePickerOpen: (open) => set({ snoozePickerOpen: open }),
  setPresetPickerOpen: (open) => set({ presetPickerOpen: open }),
  setSavedReplyPickerOpen: (open) => set({ savedReplyPickerOpen: open }),
  setFollowUpPanelOpen: (open) => set({ followUpPanelOpen: open }),
  setTriageMenuOpen: (open) => set({ triageMenuOpen: open }),
  setBulkConfirmOpen: (open) => set({ bulkConfirmOpen: open }),
  setFollowUpArmRequested: (issueId) => set({ followUpArmRequested: issueId }),
  requestAdvance: (issueId) => set({ advanceFromIssueId: issueId }),
  clearAdvance: () => set({ advanceFromIssueId: null }),

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
      s.followUpPanelOpen ||
      s.triageMenuOpen ||
      s.bulkConfirmOpen
    );
  },

  reset: () =>
    set({
      selectedIndex: 0,
      issueCount: 0,
      detailOpen: true,
      overlayOpen: false,
      labelPickerOpen: false,
      assigneePickerOpen: false,
      snoozePickerOpen: false,
      presetPickerOpen: false,
      savedReplyPickerOpen: false,
      followUpPanelOpen: false,
      triageMenuOpen: false,
      bulkConfirmOpen: false,
      followUpArmRequested: null,
      advanceFromIssueId: null,
    }),
}));
