/**
 * @module components/segmented-control
 *
 * A row of mutually exclusive options.
 *
 * Used wherever the app picks one of a short list: the token provider on the
 * sign-in page, the theme in settings, and the sync mode per repository.
 */
import { cn } from "@/lib/utils";

/** One option in a segmented control. */
export interface SegmentOption<T extends string> {
  /** Value returned when the option is picked. */
  value: T;
  /** Text shown for the option. */
  label: string;
  /** Optional glyph shown before the label. */
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string> {
  /** The available options. */
  options: SegmentOption<T>[];
  /** The selected value. */
  value: T;
  /** Called with the newly selected value. */
  onChange: (value: T) => void;
  /** Accessible name for the group. */
  ariaLabel: string;
  /** Extra classes for the group. */
  className?: string;
}

/**
 * Segmented control with one selected option.
 *
 * @param props - {@link SegmentedControlProps}
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      className={cn(
        "inline-flex max-w-full flex-wrap gap-0.5 rounded-md border bg-muted/60 p-0.5",
        className
      )}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-auto min-h-8 items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-medium transition-colors active:bg-accent disabled:cursor-not-allowed disabled:opacity-50",
            value === option.value
              ? "bg-card text-card-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}
