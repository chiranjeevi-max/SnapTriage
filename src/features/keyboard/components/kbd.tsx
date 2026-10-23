/**
 * @module keyboard/components/kbd
 *
 * Styled `<kbd>` element for displaying keyboard shortcut keys.
 * Used in tooltips, the shortcut overlay, and the landing page.
 */
import { cn } from "@/lib/utils";

interface KbdProps {
  /** The key label. */
  children: React.ReactNode;
  /** Extra classes. */
  className?: string;
  /** `inverse` is for keys shown on a filled surface. */
  tone?: "default" | "inverse";
}

/**
 * Inline keyboard key badge (e.g., displays "J", "?", "Enter").
 * Renders as a bordered, monospace chip matching shadcn/ui theme tokens.
 *
 * @param props - {@link KbdProps}
 */
export function Kbd({ children, className, tone = "default" }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded border px-1.5 font-mono text-[11px] font-medium",
        tone === "inverse"
          ? "border-primary-foreground/30 bg-primary-foreground/15 text-primary-foreground"
          : "border-border bg-muted text-muted-foreground",
        className
      )}
    >
      {children}
    </kbd>
  );
}
