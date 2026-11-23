/**
 * @module inbox/issue-sort
 *
 * Ordering for the queue, kept pure so the rules are testable without the list.
 *
 * The API returns issues newest-updated first, which is the right default for a
 * feed and the wrong one for a queue: it surfaces whatever churned most recently
 * rather than whatever has waited longest. These orderings are applied on the
 * client because the whole queue is already loaded.
 *
 * Every comparator is total. Two issues sharing a timestamp is normal — a bulk
 * action stamps them in the same millisecond — and an unstable order there makes
 * rows swap under `j` while the user is reading them, so the issue number is the
 * final tie-break.
 */
import type { IssueWithTriage } from "./use-issues";

/** An ordering the queue can be shown in. */
export type IssueSort = "updated" | "created" | "oldest-untouched" | "untriaged" | "number";

/** The orderings offered in the toolbar, in display order. */
export const ISSUE_SORTS: ReadonlyArray<{ value: IssueSort; label: string }> = [
  { value: "updated", label: "Recently updated" },
  { value: "created", label: "Newest first" },
  { value: "oldest-untouched", label: "Oldest first" },
  { value: "untriaged", label: "Untriaged first" },
  { value: "number", label: "Issue number" },
];

/** Narrow untrusted input, such as a stored preference, to a known sort. */
export function isIssueSort(value: string | null): value is IssueSort {
  return ISSUE_SORTS.some((option) => option.value === value);
}

function time(value: string): number {
  const parsed = new Date(value).getTime();
  // An unparseable timestamp must not make the comparator return NaN, which
  // would leave the whole array in whatever order the sort algorithm reached.
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** Whether a queue entry carries any triage decision at all. */
function isUntriaged(issue: IssueWithTriage): boolean {
  const triage = issue.triage;
  if (!triage) return true;
  return triage.priority === null && !triage.dismissed && !triage.snoozedUntil;
}

/**
 * Sort queue entries.
 *
 * @param issues - The entries to order; never mutated.
 * @param sort - The ordering to apply.
 * @returns A new array. `updated` returns the input unchanged in content because
 *          it is the order the API already produced.
 */
export function sortIssues(issues: IssueWithTriage[], sort: IssueSort): IssueWithTriage[] {
  const ordered = [...issues];

  if (sort === "updated") {
    // Still ordered newest-first, but with a tie-break of its own. The API sorts
    // by `updated_at` alone, so two rows sharing an instant come back in whatever
    // order the engine produced, and a refetch can move the row under the
    // keyboard selection.
    ordered.sort(
      (left, right) => time(right.updatedAt) - time(left.updatedAt) || compareIds(left, right)
    );
    return ordered;
  }

  if (sort === "untriaged") {
    // Untriaged rows lead, then the newest of those, so a fresh arrival still
    // tops the list it is meant to top.
    ordered.sort((left, right) => {
      const leftUntriaged = isUntriaged(left) ? 0 : 1;
      const rightUntriaged = isUntriaged(right) ? 0 : 1;
      if (leftUntriaged !== rightUntriaged) return leftUntriaged - rightUntriaged;
      return (
        time(right.updatedAt) - time(left.updatedAt) ||
        left.number - right.number ||
        compareIds(left, right)
      );
    });
    return ordered;
  }

  if (sort === "number") {
    // An issue number is only unique within one repository, so two connected
    // repos can both have a #12. `id` settles it.
    ordered.sort((left, right) => left.number - right.number || compareIds(left, right));
    return ordered;
  }

  const ascending = sort === "oldest-untouched";
  const field = sort === "created" ? "createdAt" : "updatedAt";

  ordered.sort((left, right) => {
    const delta = time(left[field]) - time(right[field]);
    if (delta !== 0) return ascending ? delta : -delta;
    // Two rows on the same instant: order by number, then by id, so the result
    // is the same list every time this runs.
    return left.number - right.number || compareIds(left, right);
  });

  return ordered;
}

/** The final tie-break, so every comparator is total. */
function compareIds(left: IssueWithTriage, right: IssueWithTriage): number {
  return left.id.localeCompare(right.id);
}
