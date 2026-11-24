/**
 * @module inbox/components/queue-shortcuts
 *
 * The queue's persistent keyboard legend.
 *
 * The shortcut overlay is the reference, but it is only reachable if the user
 * already knows `?`. These four hints sit under the list so the keyboard model
 * is visible while triaging, not behind a modal. They are hidden on touch-sized
 * screens, where the affordance would be noise.
 */
"use client";

import { Kbd, useKeyboardStore } from "@/features/keyboard";

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

  return (
    <div className="hidden shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t bg-card px-4 py-1.5 text-[11px] text-muted-foreground sm:flex">
      <span className="inline-flex items-center gap-1">
        <Kbd>J</Kbd>
        <Kbd>K</Kbd>
        move
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>D</Kbd>
        dismiss
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>C</Kbd>
        close
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>Z</Kbd>
        undo
      </span>
      <span className="inline-flex items-center gap-1">
        <Kbd>X</Kbd>
        select
      </span>
      {onSelectAll && (
        <button
          type="button"
          onClick={onSelectAll}
          className="inline-flex items-center gap-1 rounded px-1 py-0.5 underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
        >
          <Kbd>⇧X</Kbd>
          select all
        </button>
      )}
      <button
        type="button"
        onClick={toggleOverlay}
        className="ml-auto inline-flex items-center gap-1 rounded px-1 py-0.5 underline-offset-2 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      >
        <Kbd>?</Kbd>
        all shortcuts
      </button>
    </div>
  );
}
