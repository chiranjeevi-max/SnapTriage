/**
 * @module triage/selection
 *
 * Bulk-selection arithmetic for the queue, kept pure so the rules are testable
 * without the list.
 *
 * A selection outlives what is on screen: a filter, a search, or a sort change
 * swaps the visible rows without clearing it. The rule that follows is the one
 * this module exists to hold — an action may only touch rows the user can
 * currently see, because a bulk write to an off-screen row is one nobody can
 * connect to the keystroke that caused it.
 */
import type { IssueWithTriage } from "@/features/inbox/use-issues";

/**
 * Add or remove one row from the selection.
 *
 * @param selected - The current selection.
 * @param issueId - The row to toggle.
 * @returns A new set; the input is never mutated, so React sees a new identity.
 */
export function toggleSelected(selected: ReadonlySet<string>, issueId: string): Set<string> {
  const next = new Set(selected);
  if (next.has(issueId)) {
    next.delete(issueId);
  } else {
    next.add(issueId);
  }
  return next;
}

/**
 * Select every currently visible row, or clear if they are all already selected.
 *
 * Toggling rather than only adding is what makes the key a single-key undo for
 * an accidental select-all, which is the more likely mistake.
 *
 * @param selected - The current selection.
 * @param visible - The rows on screen, in queue order.
 * @returns A new set.
 */
export function toggleSelectAll(
  selected: ReadonlySet<string>,
  visible: readonly IssueWithTriage[]
): Set<string> {
  const allSelected = visible.length > 0 && visible.every((issue) => selected.has(issue.id));
  if (allSelected) return new Set();

  // Keep rows that scrolled out of the visible set: the user selected them
  // deliberately and clearing them here would discard work behind their back.
  const next = new Set(selected);
  for (const issue of visible) next.add(issue.id);
  return next;
}

/**
 * The selected rows that are currently visible.
 *
 * @param selected - The current selection.
 * @param visible - The rows on screen.
 * @returns The ids in queue order, so a bulk action reports the same order the
 *          user sees rather than the order they happened to click.
 */
export function visibleSelection(
  selected: ReadonlySet<string>,
  visible: readonly IssueWithTriage[]
): string[] {
  return visible.filter((issue) => selected.has(issue.id)).map((issue) => issue.id);
}
