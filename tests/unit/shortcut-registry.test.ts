/**
 * @module tests/unit/shortcut-registry
 *
 * Unit tests for the keyboard shortcut registry.
 * Covers:
 * - Shortcut array integrity (unique IDs, expected categories)
 * - Key matching for navigation, triage, and utility shortcuts
 * - Case insensitivity for letter keys
 * - Shift modifier handling (Shift+P for batch push, Shift+? for overlay)
 * - Unbound key rejection
 */
import { describe, it, expect } from "vitest";
import { matchShortcut, shortcuts } from "@/features/keyboard/shortcut-registry";

/**
 * Creates a minimal mock KeyboardEvent for testing shortcut matching
 * without requiring a full DOM environment.
 */
function makeKeyboardEvent(
  key: string,
  options: { shiftKey?: boolean } = {}
): KeyboardEvent {
  // Create a minimal object matching the KeyboardEvent interface
  // to avoid needing jsdom in the test environment
  return {
    key,
    shiftKey: options.shiftKey ?? false,
  } as KeyboardEvent;
}

describe("shortcut-registry", () => {
  describe("shortcuts array", () => {
    it("has unique IDs", () => {
      const ids = shortcuts.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("contains expected categories", () => {
      const categories = new Set(shortcuts.map((s) => s.category));
      expect(categories).toContain("navigation");
      expect(categories).toContain("triage");
      expect(categories).toContain("utility");
    });
  });

  describe("matchShortcut", () => {
    it("matches j to move-down", () => {
      const result = matchShortcut(makeKeyboardEvent("j"));
      expect(result?.id).toBe("move-down");
    });

    it("matches k to move-up", () => {
      const result = matchShortcut(makeKeyboardEvent("k"));
      expect(result?.id).toBe("move-up");
    });

    it("matches Enter to open-detail", () => {
      const result = matchShortcut(makeKeyboardEvent("Enter"));
      expect(result?.id).toBe("open-detail");
    });

    it("matches Escape to close-detail", () => {
      const result = matchShortcut(makeKeyboardEvent("Escape"));
      expect(result?.id).toBe("close-detail");
    });

    it("matches 1-4 to priority shortcuts", () => {
      expect(matchShortcut(makeKeyboardEvent("1"))?.id).toBe("priority-0");
      expect(matchShortcut(makeKeyboardEvent("2"))?.id).toBe("priority-1");
      expect(matchShortcut(makeKeyboardEvent("3"))?.id).toBe("priority-2");
      expect(matchShortcut(makeKeyboardEvent("4"))?.id).toBe("priority-3");
    });

    it("matches d to dismiss", () => {
      const result = matchShortcut(makeKeyboardEvent("d"));
      expect(result?.id).toBe("dismiss");
    });

    it("matches r to refresh", () => {
      const result = matchShortcut(makeKeyboardEvent("r"));
      expect(result?.id).toBe("refresh");
    });

    it("matches ? (Shift+/) to toggle-overlay", () => {
      const result = matchShortcut(makeKeyboardEvent("?", { shiftKey: true }));
      expect(result?.id).toBe("toggle-overlay");
    });

    it("is case-insensitive for letter keys", () => {
      expect(matchShortcut(makeKeyboardEvent("J"))?.id).toBe("move-down");
      expect(matchShortcut(makeKeyboardEvent("K"))?.id).toBe("move-up");
      expect(matchShortcut(makeKeyboardEvent("D"))?.id).toBe("dismiss");
      expect(matchShortcut(makeKeyboardEvent("R"))?.id).toBe("refresh");
    });

    it("returns null for unbound keys", () => {
      expect(matchShortcut(makeKeyboardEvent("5"))).toBeNull();
      expect(matchShortcut(makeKeyboardEvent("Tab"))).toBeNull();
      expect(matchShortcut(makeKeyboardEvent("x"))).toBeNull();
    });

    it("does not match ? without shift", () => {
      const result = matchShortcut(makeKeyboardEvent("?", { shiftKey: false }));
      expect(result).toBeNull();
    });

    it("does not match letter keys with shift held", () => {
      const result = matchShortcut(makeKeyboardEvent("J", { shiftKey: true }));
      expect(result).toBeNull();
    });

    it("matches l to labels", () => {
      const result = matchShortcut(makeKeyboardEvent("l"));
      expect(result?.id).toBe("labels");
    });

    it("matches a to assignees", () => {
      const result = matchShortcut(makeKeyboardEvent("a"));
      expect(result?.id).toBe("assignees");
    });

    it("matches s to snooze", () => {
      const result = matchShortcut(makeKeyboardEvent("s"));
      expect(result?.id).toBe("snooze");
    });

    it("matches z to undo", () => {
      const result = matchShortcut(makeKeyboardEvent("z"));
      expect(result?.id).toBe("undo");
    });

    it("matches Shift+P to batch-push", () => {
      const result = matchShortcut(makeKeyboardEvent("P", { shiftKey: true }));
      expect(result?.id).toBe("batch-push");
    });
  });
});
