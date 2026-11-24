/**
 * @module inbox/components/queue-shortcuts
 *
 * The queue's persistent keyboard legend.
 *
 * The shortcut overlay is the reference, but it is only reachable if the user
 * already knows `?`. These hints sit under the list so the keyboard model is
 * visible while triaging, not behind a modal. The labels come from the shortcut
 * registry, so a rebinding updates the legend too. They are hidden on touch
 * screens, where the affordance would be noise.
 */
"use client";

import { formatShortcutById, Kbd, useKeyboardStore } from "@/features/keyboard";

interface QueueShortcutsProps {
  /** Select every visible issue, or clear when all are selected. */
  onSelectAll?: () => void;
}

/**
 * A compact legend of the keys the current row responds to.
 *
 * @param props - {@link QueueShortcutsProps}
 * @returns The footer element, or nothing below the small-screen breakpoint.
 */
export function QueueShortcuts({ onSelectAll }: QueueShortcutsProps) {
  const toggleOverlay = useKeyboardStore((state) => state.toggleOverlay);
  // Closing the overlay is when a rebinding can have changed. Subscribing here
  // makes the legend re-read the registry instead of showing stale keys.
  useKeyboardStore((state) => state.overlayOpen);

  return (
    <div className="hidden shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-4 py-1.5 text-[11px] text-muted-foreground sm:flex">
      <span className="inline-flex items-center gap-1">
        <Kbd>{formatShortcutById("move-down")}</Kbd>
        <Kbd>{formatShortcutById("move-up")}</Kbd>
        move
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>{formatShortcutById("dismiss")}</Kbd>
        dismiss
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>{formatShortcutById("toggle-state")}</Kbd>
        close
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>{formatShortcutById("undo")}</Kbd>
        undo
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>{formatShortcutById("select-toggle")}</Kbd>
        select
      </span>
      {onSelectAll && (
        <button
          type="button"
          onClick={onSelectAll}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <Kbd>{formatShortcutById("select-all")}</Kbd>
          select all
        </button>
      )}
      <button
        type="button"
        onClick={toggleOverlay}
        className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <Kbd>{formatShortcutById("toggle-overlay")}</Kbd>
        all shortcuts
      </button>
    </div>
  );
}
