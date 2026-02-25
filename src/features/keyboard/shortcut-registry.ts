/**
 * @module keyboard/shortcut-registry
 *
 * Central registry of all keyboard shortcuts in SnapTriage.
 *
 * Each shortcut has an `id` (used to dispatch actions), a `key` (the physical key),
 * an optional `shift` modifier, a human-readable `description`, and a `category`
 * for grouping in the shortcut overlay.
 *
 * {@link matchShortcut} performs the key→shortcut lookup on each keydown event.
 */

/** Definition of a single keyboard shortcut. */
export interface Shortcut {
  id: string;
  key: string;
  shift?: boolean;
  description: string;
  category: "navigation" | "triage" | "utility";
}

/** Complete list of registered shortcuts, ordered by category then key. */
export const shortcuts: Shortcut[] = [
  { id: "move-down", key: "j", category: "navigation", description: "Next issue" },
  { id: "move-up", key: "k", category: "navigation", description: "Previous issue" },
  { id: "open-detail", key: "Enter", category: "navigation", description: "Open issue" },
  { id: "close-detail", key: "Escape", category: "navigation", description: "Close detail" },
  { id: "priority-0", key: "1", category: "triage", description: "Set P0 Critical" },
  { id: "priority-1", key: "2", category: "triage", description: "Set P1 High" },
  { id: "priority-2", key: "3", category: "triage", description: "Set P2 Medium" },
  { id: "priority-3", key: "4", category: "triage", description: "Set P3 Low" },
  { id: "dismiss", key: "d", category: "triage", description: "Toggle dismiss" },
  { id: "labels", key: "l", category: "triage", description: "Edit labels" },
  { id: "assignees", key: "a", category: "triage", description: "Edit assignees" },
  { id: "snooze", key: "s", category: "triage", description: "Snooze issue" },
  { id: "undo", key: "z", category: "triage", description: "Undo last action" },
  {
    id: "batch-push",
    key: "P",
    shift: true,
    category: "triage",
    description: "Push batch changes",
  },
  { id: "refresh", key: "r", category: "utility", description: "Sync issues" },
  {
    id: "toggle-overlay",
    key: "?",
    shift: true,
    category: "utility",
    description: "Show shortcuts",
  },
];

/**
 * Matches a keyboard event to a registered shortcut.
 * Compares keys case-insensitively and checks the shift modifier.
 * @param event - The browser KeyboardEvent to match.
 * @returns The matched shortcut, or `null` if no match.
 */
export function matchShortcut(event: KeyboardEvent): Shortcut | null {
  for (const shortcut of shortcuts) {
    if (shortcut.shift && !event.shiftKey) continue;
    if (!shortcut.shift && event.shiftKey) continue;

    const eventKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
    const shortcutKey = shortcut.key.length === 1 ? shortcut.key.toLowerCase() : shortcut.key;

    if (eventKey === shortcutKey) return shortcut;
  }
  return null;
}
