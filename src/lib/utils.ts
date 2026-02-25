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
