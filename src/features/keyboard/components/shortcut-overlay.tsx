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
import { useKeyboardStore } from "@/features/keyboard/keyboard-store";
import {
  shortcuts,
  setShortcutOverride,
  resetShortcutOverrides,
  formatKey,
  categoryLabels,
  categoryOrder,
} from "@/features/keyboard/shortcut-registry";
import { Kbd } from "@/features/keyboard/components/kbd";

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
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-5 overflow-hidden p-5 sm:max-w-md sm:p-6">
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Navigate and triage issues without leaving the keyboard. Click a key to rebind it.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-5 overflow-y-auto">
          {grouped.map((group) => (
            <div key={group.label}>
              <h3 className="mb-2 text-xs font-medium text-muted-foreground">{group.label}</h3>
              <div className="space-y-0.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.id}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 text-sm"
                  >
                    <span className="min-w-0 break-words text-muted-foreground">
                      {shortcut.description}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingId(shortcut.id)}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md px-2 transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
                      aria-label={`Rebind ${shortcut.description}`}
                    >
                      {editingId === shortcut.id ? (
                        <span className="rounded border border-dashed border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                          Press a key…
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
          className="min-h-11 shrink-0 self-start px-2 text-xs text-muted-foreground"
        >
          Reset shortcuts
        </Button>
      </DialogContent>
    </Dialog>
  );
}
