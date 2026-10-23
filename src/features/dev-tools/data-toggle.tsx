/**
 * @module features/dev-tools/data-toggle
 *
 * The dev-only data toggle.
 *
 * It rests as a small chip in the bottom-right corner showing the current
 * mode, so it covers as little of the page under review as possible. Hovering
 * it — or tabbing to it — expands the full segmented control; leaving the
 * control, or moving focus out of it, collapses it again.
 */
"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { DATA_MODES, useDataMode, writeDataMode, type DataMode } from "./data-mode";

/** Label for each mode. */
const LABELS: Record<DataMode, string> = {
  demo: "Demo",
  worst: "Worst",
  empty: "Empty",
  one: "One",
  many: "1,000",
};

/**
 * Segmented control that switches the data the app renders.
 */
export function DevDataToggle() {
  const mode = useDataMode();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function select(next: DataMode) {
    if (next === mode) return;
    writeDataMode(next);
    queryClient.invalidateQueries();
  }

  // Collapsing on focus-out keeps the resting chip the only thing on screen
  // once the user has moved on to the page they are reviewing.
  function handleBlur(event: React.FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setExpanded(false);
    }
  }

  // A pointer leaving the control closes it, unless focus is still inside —
  // a keyboard user must not lose the control out from under them.
  function handlePointerLeave() {
    if (!containerRef.current?.contains(document.activeElement)) {
      setExpanded(false);
    }
  }

  return (
    <div
      ref={containerRef}
      className="fixed bottom-2 right-2 z-[100] flex flex-col-reverse items-end gap-1.5"
      onPointerEnter={() => setExpanded(true)}
      onPointerLeave={handlePointerLeave}
      onFocus={() => setExpanded(true)}
      onBlur={handleBlur}
    >
      {/* The chip is first in the DOM so the tab order runs chip → segments. */}
      <button
        type="button"
        aria-label={`Data fixtures: ${LABELS[mode]}`}
        aria-expanded={expanded}
        onClick={() => setExpanded(true)}
        className="select-none rounded-full border border-neutral-300 bg-neutral-200 px-2 py-0.5 text-[11px] font-medium text-neutral-700 opacity-70 shadow-sm transition-opacity hover:opacity-100 focus-visible:opacity-100 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200"
      >
        {LABELS[mode]}
      </button>

      {expanded && (
        <div
          role="group"
          aria-label="Data fixtures"
          className="flex items-center gap-0.5 rounded-full border border-neutral-300 bg-neutral-200 p-0.5 shadow-sm dark:border-neutral-700 dark:bg-neutral-800"
        >
          {DATA_MODES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => select(option)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs font-medium transition-colors",
                mode === option
                  ? "bg-white text-neutral-900 shadow-sm dark:bg-neutral-50 dark:text-neutral-900"
                  : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
              )}
            >
              {LABELS[option]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
