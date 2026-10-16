/**
 * @module keyboard/components/shortcut-overlay
 *
 * Modal dialog listing all registered keyboard shortcuts, grouped by category.
 * Toggled by pressing "?" or clicking the keyboard icon in the sidebar.
 */
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useKeyboardStore } from "../keyboard-store";
import {
  shortcuts,
  type Shortcut,
  getShortcutKey,
  setShortcutOverride,
  resetShortcutOverrides,
} from "../shortcut-registry";
import { Kbd } from "./kbd";

/** Human-readable labels for shortcut categories. */
const categoryLabels: Record<Shortcut["category"], string> = {
  navigation: "Navigation",
  triage: "Triage",
  utility: "Utility",
};

/** Display order for shortcut categories in the overlay. */
const categoryOrder: Shortcut["category"][] = ["navigation", "triage", "utility"];

/** Modal dialog showing all keyboard shortcuts grouped by category. */
export function ShortcutOverlay() {
  const { overlayOpen, toggleOverlay } = useKeyboardStore();
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!editingId) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        setEditingId(null);
        return;
      }
      setShortcutOverride(editingId, event.key);
      setEditingId(null);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [editingId]);

  const grouped = categoryOrder.map((cat) => ({
    label: categoryLabels[cat],
    shortcuts: shortcuts.filter((s) => s.category === cat),
  }));

  return (
    <Dialog open={overlayOpen} onOpenChange={toggleOverlay}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>
            Navigate and triage issues without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {grouped.map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                {group.label}
              </h3>
              <div className="space-y-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
                  >
                    <span>{shortcut.description}</span>
                    <button
                      type="button"
                      onClick={() => setEditingId(shortcut.id)}
                      className="rounded border px-2 py-0.5"
                      aria-label={`Rebind ${shortcut.description}`}
                    >
                      {editingId === shortcut.id ? (
                        "Press a key..."
                      ) : (
                        <Kbd>{formatKey(shortcut)}</Kbd>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={resetShortcutOverrides}
          className="text-xs text-muted-foreground underline"
        >
          Reset keyboard shortcuts
        </button>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Formats a shortcut key for display (e.g., Enter → "↵", Escape → "Esc").
 * @param shortcut - The shortcut definition.
 */
function formatKey(shortcut: Shortcut): string {
  const key = getShortcutKey(shortcut);
  if (key === "Enter") return "\u21B5";
  if (key === "Escape") return "Esc";
  if (shortcut.shift && key === shortcut.key) return key;
  return key.toUpperCase();
}
