import { describe, it, expect, beforeEach } from "vitest";
import { useKeyboardStore } from "@/features/keyboard/keyboard-store";

describe("keyboard-store", () => {
  beforeEach(() => {
    useKeyboardStore.getState().reset();
  });

  describe("initial state", () => {
    it("has correct default values", () => {
      const state = useKeyboardStore.getState();
      expect(state.selectedIndex).toBe(0);
      expect(state.issueCount).toBe(0);
      expect(state.detailOpen).toBe(true);
      expect(state.overlayOpen).toBe(false);
      expect(state.labelPickerOpen).toBe(false);
      expect(state.assigneePickerOpen).toBe(false);
      expect(state.snoozePickerOpen).toBe(false);
      expect(state.presetPickerOpen).toBe(false);
      expect(state.savedReplyPickerOpen).toBe(false);
      expect(state.followUpPanelOpen).toBe(false);
      expect(state.triageMenuOpen).toBe(false);
      expect(state.followUpArmRequested).toBeNull();
      expect(state.advanceFromIssueId).toBeNull();
    });
  });

  describe("setSelectedIndex", () => {
    it("updates selectedIndex", () => {
      useKeyboardStore.getState().setSelectedIndex(5);
      expect(useKeyboardStore.getState().selectedIndex).toBe(5);
    });
  });

  describe("setIssueCount", () => {
    it("updates issueCount", () => {
      useKeyboardStore.getState().setIssueCount(10);
      expect(useKeyboardStore.getState().issueCount).toBe(10);
    });

    it("clamps selectedIndex to issueCount bounds", () => {
      useKeyboardStore.getState().setIssueCount(10);
      useKeyboardStore.getState().setSelectedIndex(5);
      useKeyboardStore.getState().setIssueCount(3);
      expect(useKeyboardStore.getState().selectedIndex).toBe(2);
    });

    it("handles zero issueCount", () => {
      useKeyboardStore.getState().setIssueCount(10);
      useKeyboardStore.getState().setSelectedIndex(5);
      useKeyboardStore.getState().setIssueCount(0);
      expect(useKeyboardStore.getState().selectedIndex).toBe(0);
    });
  });

  describe("moveSelection", () => {
    it("does nothing when issueCount is 0", () => {
      useKeyboardStore.getState().moveSelection(1);
      expect(useKeyboardStore.getState().selectedIndex).toBe(0);
    });

    it("reopens the detail pane when the cursor moves", () => {
      const state = useKeyboardStore.getState();
      state.setIssueCount(10);
      state.setSelectedIndex(4);
      state.setDetailOpen(false);
      state.moveSelection(1);

      expect(useKeyboardStore.getState().selectedIndex).toBe(5);
      expect(useKeyboardStore.getState().detailOpen).toBe(true);
    });

    it("moves selection forward", () => {
      useKeyboardStore.getState().setIssueCount(10);
      useKeyboardStore.getState().moveSelection(1);
      expect(useKeyboardStore.getState().selectedIndex).toBe(1);
    });

    it("moves selection backward", () => {
      useKeyboardStore.getState().setIssueCount(10);
      useKeyboardStore.getState().setSelectedIndex(5);
      useKeyboardStore.getState().moveSelection(-1);
      expect(useKeyboardStore.getState().selectedIndex).toBe(4);
    });

    it("stops at 0 when moving backward", () => {
      useKeyboardStore.getState().setIssueCount(10);
      useKeyboardStore.getState().moveSelection(-1);
      expect(useKeyboardStore.getState().selectedIndex).toBe(0);
    });

    it("stops at max index when moving forward", () => {
      useKeyboardStore.getState().setIssueCount(3);
      useKeyboardStore.getState().setSelectedIndex(2);
      useKeyboardStore.getState().moveSelection(1);
      expect(useKeyboardStore.getState().selectedIndex).toBe(2);
    });
  });

  describe("toggleOverlay", () => {
    it("toggles overlayOpen", () => {
      useKeyboardStore.getState().toggleOverlay();
      expect(useKeyboardStore.getState().overlayOpen).toBe(true);

      useKeyboardStore.getState().toggleOverlay();
      expect(useKeyboardStore.getState().overlayOpen).toBe(false);
    });
  });

  describe("pickers", () => {
    it("updates labelPickerOpen", () => {
      useKeyboardStore.getState().setLabelPickerOpen(true);
      expect(useKeyboardStore.getState().labelPickerOpen).toBe(true);
    });

    it("updates assigneePickerOpen", () => {
      useKeyboardStore.getState().setAssigneePickerOpen(true);
      expect(useKeyboardStore.getState().assigneePickerOpen).toBe(true);
    });

    it("updates snoozePickerOpen", () => {
      useKeyboardStore.getState().setSnoozePickerOpen(true);
      expect(useKeyboardStore.getState().snoozePickerOpen).toBe(true);
    });

    it("updates presetPickerOpen", () => {
      useKeyboardStore.getState().setPresetPickerOpen(true);
      expect(useKeyboardStore.getState().presetPickerOpen).toBe(true);

      useKeyboardStore.getState().setPresetPickerOpen(false);
      expect(useKeyboardStore.getState().presetPickerOpen).toBe(false);
    });

    it("updates savedReplyPickerOpen", () => {
      useKeyboardStore.getState().setSavedReplyPickerOpen(true);
      expect(useKeyboardStore.getState().savedReplyPickerOpen).toBe(true);

      useKeyboardStore.getState().setSavedReplyPickerOpen(false);
      expect(useKeyboardStore.getState().savedReplyPickerOpen).toBe(false);
    });

    it("updates followUpPanelOpen", () => {
      useKeyboardStore.getState().setFollowUpPanelOpen(true);
      expect(useKeyboardStore.getState().followUpPanelOpen).toBe(true);

      useKeyboardStore.getState().setFollowUpPanelOpen(false);
      expect(useKeyboardStore.getState().followUpPanelOpen).toBe(false);
    });

    it("updates triageMenuOpen", () => {
      useKeyboardStore.getState().setTriageMenuOpen(true);
      expect(useKeyboardStore.getState().triageMenuOpen).toBe(true);

      useKeyboardStore.getState().setTriageMenuOpen(false);
      expect(useKeyboardStore.getState().triageMenuOpen).toBe(false);
    });
  });

  describe("followUpArmRequested", () => {
    it("carries the issue the shortcut was pressed for", () => {
      const state = useKeyboardStore.getState();
      state.setFollowUpArmRequested("issue-7");
      expect(useKeyboardStore.getState().followUpArmRequested).toBe("issue-7");

      // The consumer clears it, so a failed arm cannot re-fire on the next render.
      state.setFollowUpArmRequested(null);
      expect(useKeyboardStore.getState().followUpArmRequested).toBeNull();
    });

    it("does not make the store think a dialog is open", () => {
      // The flag is a one-shot request, not a modal. Treating it as one would
      // mute the keyboard until the next unrelated picker closed.
      useKeyboardStore.getState().setFollowUpArmRequested("issue-7");
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(false);
    });
  });

  describe("advanceFromIssueId", () => {
    it("carries the issue an action settled on until the queue resolves it", () => {
      const state = useKeyboardStore.getState();
      state.requestAdvance("issue-9");
      expect(useKeyboardStore.getState().advanceFromIssueId).toBe("issue-9");

      state.clearAdvance();
      expect(useKeyboardStore.getState().advanceFromIssueId).toBeNull();
    });

    it("does not make the store think a dialog is open", () => {
      useKeyboardStore.getState().requestAdvance("issue-9");
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(false);
    });
  });

  describe("isAnyPickerOpen", () => {
    it("returns false initially", () => {
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(false);
    });

    it("returns true when label picker is open", () => {
      useKeyboardStore.getState().setLabelPickerOpen(true);
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(true);
    });

    it("returns true when assignee picker is open", () => {
      useKeyboardStore.getState().setAssigneePickerOpen(true);
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(true);
    });

    it("returns true when snooze picker is open", () => {
      useKeyboardStore.getState().setSnoozePickerOpen(true);
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(true);
    });

    it("returns true when the preset picker is open", () => {
      useKeyboardStore.getState().setPresetPickerOpen(true);
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(true);
    });

    it("returns true when the saved-reply picker is open", () => {
      // The dialog's buttons are not editable elements, so without this flag a
      // shortcut fired while it was open would act on the issue behind it.
      useKeyboardStore.getState().setSavedReplyPickerOpen(true);
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(true);
    });

    it("returns true when the follow-up details panel is open", () => {
      useKeyboardStore.getState().setFollowUpPanelOpen(true);
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(true);
    });

    it("returns true when the triage menu is open", () => {
      // The menu's items are not editable elements, so without this flag a
      // shortcut would act on the issue behind the open menu.
      useKeyboardStore.getState().setTriageMenuOpen(true);
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(true);
    });

    it("returns false again once every picker is closed", () => {
      const state = useKeyboardStore.getState();
      state.setPresetPickerOpen(true);
      state.setPresetPickerOpen(false);
      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(false);
    });
  });

  describe("reset", () => {
    it("resets state to initial values", () => {
      const state = useKeyboardStore.getState();
      state.setSelectedIndex(5);
      state.setIssueCount(10);
      state.toggleOverlay();
      state.setLabelPickerOpen(true);
      state.setPresetPickerOpen(true);
      state.setSavedReplyPickerOpen(true);
      state.setFollowUpPanelOpen(true);
      state.setTriageMenuOpen(true);
      state.setFollowUpArmRequested("issue-7");
      state.requestAdvance("issue-9");
      state.setDetailOpen(false);

      state.reset();

      const newState = useKeyboardStore.getState();
      expect(newState.selectedIndex).toBe(0);
      expect(newState.issueCount).toBe(0);
      expect(newState.detailOpen).toBe(true);
      expect(newState.overlayOpen).toBe(false);
      expect(newState.labelPickerOpen).toBe(false);
      expect(newState.assigneePickerOpen).toBe(false);
      expect(newState.snoozePickerOpen).toBe(false);
      expect(newState.presetPickerOpen).toBe(false);
      expect(newState.savedReplyPickerOpen).toBe(false);
      expect(newState.followUpPanelOpen).toBe(false);
      expect(newState.triageMenuOpen).toBe(false);
      expect(newState.followUpArmRequested).toBeNull();
      expect(newState.advanceFromIssueId).toBeNull();
    });

    it("leaves no dialog flag set, so the keyboard is not muted after a sign-out", () => {
      const state = useKeyboardStore.getState();
      state.setSavedReplyPickerOpen(true);
      state.setFollowUpPanelOpen(true);
      state.setTriageMenuOpen(true);

      state.reset();

      expect(useKeyboardStore.getState().isAnyPickerOpen()).toBe(false);
    });
  });
  describe("setIssueCount", () => {
    /**
     * @target setIssueCount
     * @dependencies selectedIndex
     * @scenario The queue shrinks to fewer rows than the current selection
     * @expectedOutput The selection clamps, so navigation stays inside the list
     */
    it("clamps the selection when the queue shrinks", () => {
      const state = useKeyboardStore.getState();
      state.setIssueCount(10);
      state.setSelectedIndex(7);

      state.setIssueCount(3);

      expect(useKeyboardStore.getState().selectedIndex).toBe(2);
    });

    /**
     * @target setIssueCount
     * @dependencies selectedIndex
     * @scenario The follow-up surface is shown, which is not the queue
     * @expectedOutput The queue selection survives. Reporting a count of zero
     *                 would move the detail pane to row 0 and, if that pane is
     *                 uncached, unmount the composer with text still in it.
     */
    it("preserves the queue selection when no list is being navigated", () => {
      const state = useKeyboardStore.getState();
      state.setIssueCount(10);
      state.setSelectedIndex(7);

      state.setIssueCount(null);

      expect(useKeyboardStore.getState().selectedIndex).toBe(7);
    });
  });
});
