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
import { Button } from "@/components/ui/button";
import { useKeyboardStore } from "../keyboard-store";
import {
  shortcuts,
  setShortcutOverride,
  resetShortcutOverrides,
  formatKey,
  categoryLabels,
  categoryOrder,
} from "../shortcut-registry";
import { Kbd } from "./kbd";

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
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Navigate and triage issues without leaving the keyboard. Click a key to rebind it.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          {grouped.map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.label}</h3>
              <div className="space-y-0.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex items-center justify-between gap-4 rounded-md px-2 py-1.5 text-sm"
                  >
                    <span className="text-muted-foreground">{shortcut.description}</span>
                    <button
                      type="button"
                      onClick={() => setEditingId(shortcut.id)}
                      className="rounded-md transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      aria-label={`Rebind ${shortcut.description}`}
                    >
                      {editingId === shortcut.id ? (
                        <span className="rounded border border-dashed border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                          Press a key...
                        </span>
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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={resetShortcutOverrides}
          className="h-7 self-start px-2 text-xs text-muted-foreground"
        >
          Reset shortcuts
        </Button>
      </DialogContent>
    </Dialog>
  );
}
