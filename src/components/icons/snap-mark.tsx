/**
 * @module components/icons/snap-mark
 * SnapTriage wordmark glyph: a text caret standing next to two list rows.
 * The caret is the keyboard, the rows are the queue it moves through.
 */

interface SnapMarkProps {
  className?: string;
}

/** Inline SnapTriage mark SVG matching the lucide-react icon API. */
export function SnapMark({ className }: SnapMarkProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 3.5v17" />
      <path d="M11 8h8" />
      <path d="M11 15h5" />
    </svg>
  );
}
