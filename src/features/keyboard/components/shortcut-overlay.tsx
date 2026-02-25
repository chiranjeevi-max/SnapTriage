"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useKeyboardStore } from "../keyboard-store";
import { shortcuts, type Shortcut } from "../shortcut-registry";
import { Kbd } from "./kbd";

const categoryLabels: Record<Shortcut["category"], string> = {
  navigation: "Navigation",
  triage: "Triage",
  utility: "Utility",
};

const categoryOrder: Shortcut["category"][] = ["navigation", "triage", "utility"];

export function ShortcutOverlay() {
  const { overlayOpen, toggleOverlay } = useKeyboardStore();

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
                    <Kbd>{formatKey(shortcut)}</Kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function formatKey(shortcut: Shortcut): string {
  if (shortcut.key === "Enter") return "\u21B5";
  if (shortcut.key === "Escape") return "Esc";
  if (shortcut.shift) return shortcut.key;
  return shortcut.key.toUpperCase();
}
