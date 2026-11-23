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
import { matchShortcut, formatKey, shortcuts } from "@/features/keyboard/shortcut-registry";

/**
 * Creates a minimal mock KeyboardEvent for testing shortcut matching
 * without requiring a full DOM environment.
 */
function makeKeyboardEvent(
  key: string,
  options: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}
): KeyboardEvent {
  // Create a minimal object matching the KeyboardEvent interface
  // to avoid needing jsdom in the test environment
  return {
    key,
    shiftKey: options.shiftKey ?? false,
    ctrlKey: options.ctrlKey ?? false,
    metaKey: options.metaKey ?? false,
    altKey: options.altKey ?? false,
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
      expect(matchShortcut(makeKeyboardEvent("q"))).toBeNull();
    });

    it("matches x to select-toggle", () => {
      expect(matchShortcut(makeKeyboardEvent("x"))?.id).toBe("select-toggle");
    });

    it("matches shift+x to select-all", () => {
      expect(matchShortcut(makeKeyboardEvent("X", { shiftKey: true }))?.id).toBe("select-all");
    });

    it("matches c to toggle-state", () => {
      expect(matchShortcut(makeKeyboardEvent("c"))?.id).toBe("toggle-state");
    });

    /**
     * @target matchShortcut
     * @dependencies none
     * @scenario A letter key pressed with a command modifier
     * @expectedOutput No match. Cmd+C on selected issue text matched `c` and
     *                 closed the issue instead of copying, and the listener calls
     *                 `preventDefault` on a match.
     */
    it("ignores a shortcut pressed with a command modifier", () => {
      expect(matchShortcut(makeKeyboardEvent("c", { metaKey: true }))).toBeNull();
      expect(matchShortcut(makeKeyboardEvent("c", { ctrlKey: true }))).toBeNull();
      expect(matchShortcut(makeKeyboardEvent("c", { altKey: true }))).toBeNull();
      expect(matchShortcut(makeKeyboardEvent("d", { metaKey: true }))).toBeNull();
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

    it("matches t to presets", () => {
      const result = matchShortcut(makeKeyboardEvent("t"));
      expect(result?.id).toBe("presets");
    });

    it("binds presets to a key no other shortcut claims", () => {
      const presets = shortcuts.find((shortcut) => shortcut.id === "presets");
      expect(presets).toBeDefined();
      expect(presets?.key).toBe("t");
      expect(presets?.category).toBe("triage");

      const collisions = shortcuts.filter(
        (shortcut) =>
          shortcut.id !== "presets" &&
          shortcut.key.toLowerCase() === "t" &&
          (shortcut.shift ?? false) === (presets?.shift ?? false)
      );
      expect(collisions).toEqual([]);
      // `t` must also resolve to exactly one shortcut when matched at runtime.
      expect(shortcuts.filter((shortcut) => shortcut.key.toLowerCase() === "t")).toHaveLength(1);
    });

    it("matches Shift+P to batch-push", () => {
      const result = matchShortcut(makeKeyboardEvent("P", { shiftKey: true }));
      expect(result?.id).toBe("batch-push");
    });

    it("matches w to follow-up", () => {
      const result = matchShortcut(makeKeyboardEvent("w"));
      expect(result?.id).toBe("follow-up");
    });

    it("binds follow-up to a key no other shortcut claims", () => {
      const followUp = shortcuts.find((shortcut) => shortcut.id === "follow-up");
      expect(followUp).toBeDefined();
      expect(followUp?.key).toBe("w");
      expect(followUp?.category).toBe("triage");

      // `w` was free when this was added: the letters in use were d, l, a, s,
      // t, z, and Shift+P. A collision here would silently shadow one of them.
      const collisions = shortcuts.filter(
        (shortcut) =>
          shortcut.id !== "follow-up" &&
          shortcut.key.toLowerCase() === "w" &&
          (shortcut.shift ?? false) === (followUp?.shift ?? false)
      );
      expect(collisions).toEqual([]);
      expect(shortcuts.filter((shortcut) => shortcut.key.toLowerCase() === "w")).toHaveLength(1);
    });

    it("keeps every triage key distinct so no action shadows another", () => {
      const bound = shortcuts
        .filter((shortcut) => shortcut.category === "triage")
        .map((shortcut) => `${shortcut.key.toLowerCase()}:${shortcut.shift ?? false}`);
      expect(new Set(bound).size).toBe(bound.length);
    });
  });

  describe("formatKey", () => {
    it("renders the Enter key as an arrow", () => {
      const enter = shortcuts.find((shortcut) => shortcut.id === "open-detail");
      expect(formatKey(enter!)).toBe("↵");
    });

    it("abbreviates the Escape key", () => {
      const escape = shortcuts.find((shortcut) => shortcut.id === "close-detail");
      expect(formatKey(escape!)).toBe("Esc");
    });

    it("upper-cases letter keys and keeps shifted keys as they are", () => {
      const dismiss = shortcuts.find((shortcut) => shortcut.id === "dismiss");
      const batch = shortcuts.find((shortcut) => shortcut.id === "batch-push");
      expect(formatKey(dismiss!)).toBe("D");
      expect(formatKey(batch!)).toBe("P");
    });
  });
});
