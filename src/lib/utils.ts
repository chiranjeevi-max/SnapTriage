/**
 * @module utils
 *
 * Shared utility functions used across the SnapTriage UI.
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges class names using `clsx` and resolves Tailwind CSS conflicts via `twMerge`.
 * This is the standard pattern recommended by shadcn/ui for composing className props.
 * @param inputs - Class values (strings, arrays, objects) to merge.
 * @returns A single, conflict-free className string.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formats a date string into a human-readable relative time.
 *
 * @param dateStr - ISO date string to format.
 * @param options - Formatting options.
 * @param options.suffix - Whether to append "ago" suffix (default: false).
 * @param options.nowLabel - Label for very recent times (default: "now").
 * @returns Compact relative time string, e.g. "5m", "2h ago", "3d".
 */
export function formatRelativeTime(
  dateStr: string | null,
  options?: { suffix?: boolean; nowLabel?: string }
): string {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return "Never";
  const { suffix = false, nowLabel = "now" } = options ?? {};
  const diffMs = Date.now() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);

  const s = suffix ? " ago" : "";

  if (diffMins < 1) return nowLabel;
  if (diffMins < 60) return `${diffMins}m${s}`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h${s}`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays}d${s}`;
  const diffMonths = Math.floor(diffDays / 30);
  return `${diffMonths}mo${s}`;
}
