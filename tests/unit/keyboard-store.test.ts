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
      expect(state.overlayOpen).toBe(false);
      expect(state.labelPickerOpen).toBe(false);
      expect(state.assigneePickerOpen).toBe(false);
      expect(state.snoozePickerOpen).toBe(false);
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
  });

  describe("reset", () => {
    it("resets state to initial values", () => {
      const state = useKeyboardStore.getState();
      state.setSelectedIndex(5);
      state.setIssueCount(10);
      state.toggleOverlay();
      state.setLabelPickerOpen(true);

      state.reset();

      const newState = useKeyboardStore.getState();
      expect(newState.selectedIndex).toBe(0);
      expect(newState.issueCount).toBe(0);
      expect(newState.overlayOpen).toBe(false);
      expect(newState.labelPickerOpen).toBe(false);
      expect(newState.assigneePickerOpen).toBe(false);
      expect(newState.snoozePickerOpen).toBe(false);
    });
  });
});
