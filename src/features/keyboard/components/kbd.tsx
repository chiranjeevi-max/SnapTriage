/**
 * @module keyboard/components/kbd
 *
 * Styled `<kbd>` element for displaying keyboard shortcut keys.
 * Used in tooltips and the shortcut overlay.
 */
import { cn } from "@/lib/utils";

/**
 * Inline keyboard key badge (e.g., displays "J", "?", "Enter").
 * Renders as a bordered, monospace chip matching shadcn/ui theme tokens.
 */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-muted px-1.5 font-mono text-[11px] font-medium text-muted-foreground",
        className
      )}
    >
      {children}
    </kbd>
  );
}
