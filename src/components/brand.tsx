/**
 * @module components/brand
 *
 * The SnapTriage mark and wordmark. Used by the landing page, the sign-in
 * page, the app shell, and the footer so the product reads the same
 * everywhere.
 */
import Link from "next/link";
import { SnapMark } from "@/components/icons/snap-mark";
import { cn } from "@/lib/utils";

interface WordmarkProps {
  /** Where the wordmark links to. */
  href: string;
  /** Extra classes for the wordmark container. */
  className?: string;
  /** Size of the mark glyph. */
  size?: "sm" | "md";
}

/**
 * The wordmark: the caret glyph next to the product name.
 *
 * @param props - {@link WordmarkProps}
 */
export function Wordmark({ href, className, size = "md" }: WordmarkProps) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex shrink-0 items-center gap-2.5 rounded-sm text-foreground focus-visible:outline-2 focus-visible:outline-offset-4",
        className
      )}
      aria-label="SnapTriage home"
    >
      <SnapMark className={size === "sm" ? "h-5 w-5" : "h-6 w-6"} />
      <span className={cn("font-semibold tracking-tight", size === "sm" ? "text-base" : "text-lg")}>
        SnapTriage
      </span>
    </Link>
  );
}
