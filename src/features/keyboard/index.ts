/**
 * @module keyboard
 *
 * Barrel export for the keyboard navigation feature.
 * Re-exports the store, registry, hooks, and UI components used by the inbox.
 */
export { useKeyboardStore } from "./keyboard-store";
export { shortcuts, matchShortcut, type Shortcut } from "./shortcut-registry";
export { useKeyboardShortcuts } from "./use-keyboard-shortcuts";
export { useKeyboardActions } from "./use-keyboard-actions";
export { ShortcutOverlay } from "./components/shortcut-overlay";
export { Kbd } from "./components/kbd";
