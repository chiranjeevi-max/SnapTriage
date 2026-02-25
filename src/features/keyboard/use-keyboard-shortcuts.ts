/**
 * @module keyboard/use-keyboard-shortcuts
 *
 * Global keydown listener that matches keyboard events to registered shortcuts
 * and dispatches the corresponding action.
 *
 * Guards:
 * - Ignores events when focus is in an editable element (input, textarea, contenteditable)
 * - Ignores events when any picker dialog is open
 * - When the shortcut overlay is open, only "?" and Escape pass through
 */
"use client";

import { useEffect } from "react";
import { useKeyboardStore } from "./keyboard-store";
import { matchShortcut } from "./shortcut-registry";
import { useKeyboardActions } from "./use-keyboard-actions";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

/**
 * Checks whether the event target is an editable form element.
 * Prevents shortcut firing when the user is typing in inputs.
 */
function isEditableElement(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Attaches a global keydown listener that dispatches matched shortcuts.
 * Must be called once in the inbox view with the current issue list.
 * @param issues - Current issue list (forwarded to action dispatch).
 */
export function useKeyboardShortcuts(issues: IssueWithTriage[]) {
  const overlayOpen = useKeyboardStore((s) => s.overlayOpen);
  const isAnyPickerOpen = useKeyboardStore((s) => s.isAnyPickerOpen);
  const execute = useKeyboardActions(issues);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // Don't fire shortcuts when typing in inputs
      if (isEditableElement(event.target)) return;

      // Don't fire shortcuts when any picker dialog is open
      if (isAnyPickerOpen()) return;

      // When overlay is open, only allow closing it
      if (overlayOpen && event.key !== "?" && event.key !== "Escape") return;

      const shortcut = matchShortcut(event);
      if (!shortcut) return;

      event.preventDefault();
      execute(shortcut.id);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [overlayOpen, isAnyPickerOpen, execute]);
}
