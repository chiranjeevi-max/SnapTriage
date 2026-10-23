/**
 * @module components/empty-state
 *
 * The shared empty state. An empty screen is an invitation to act, so the
 * pattern is always the same: a glyph, a line about what is missing, and the
 * next step when there is one.
 */
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  /** Glyph shown above the title. */
  icon: React.ReactNode;
  /** What is missing, in one line. */
  title: string;
  /** Renders the title as a page heading instead of a line of text. */
  titleAs?: "h1" | "p";
  /** What to do about it. */
  description?: string;
  /** The next step, usually a button. */
  action?: React.ReactNode;
  /** Extra classes for the wrapper. */
  className?: string;
}

/**
 * Centered empty state with an optional call to action.
 *
 * @param props - {@link EmptyStateProps}
 */
export function EmptyState({
  icon,
  title,
  titleAs = "p",
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-full border bg-muted/40 text-muted-foreground">
        {icon}
      </div>
      {titleAs === "h1" ? (
        <h1 className="mt-4 text-base font-medium">{title}</h1>
      ) : (
        <p className="mt-4 text-sm font-medium">{title}</p>
      )}
      {description && (
        <p className="mt-1.5 max-w-[42ch] text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
