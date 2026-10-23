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
      className={cn("flex items-center gap-2.5 text-foreground", className)}
      aria-label="SnapTriage home"
    >
      <SnapMark className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
      <span
        className={cn("font-semibold tracking-tight", size === "sm" ? "text-sm" : "text-[15px]")}
      >
        SnapTriage
      </span>
    </Link>
  );
}
