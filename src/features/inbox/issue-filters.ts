/**
 * @module inbox/issue-filters
 *
 * Pure helpers for client-side issue filtering in the inbox.
 * Kept separate from components so the matching logic is unit-testable
 * without rendering React.
 */
import type { IssueWithTriage } from "./use-issues";

/** Named view filters available in the inbox. */
export type IssueFilter = "all" | "open" | "dismissed" | "snoozed" | "urgent";

/** Human-readable labels for the filter picker. */
export const ISSUE_FILTERS: ReadonlyArray<{ value: IssueFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "dismissed", label: "Dismissed" },
  { value: "snoozed", label: "Snoozed" },
  { value: "urgent", label: "P0–P1" },
];

/** Returns true when the issue matches the selected filter. */
export function matchesIssueFilter(issue: IssueWithTriage, filter: IssueFilter): boolean {
  const triage = issue.triage;
  const dismissed = triage?.dismissed ?? false;
  const snoozed = Boolean(
    triage?.snoozedUntil && new Date(triage.snoozedUntil).getTime() > Date.now()
  );
  const priority = triage?.priority ?? null;

  switch (filter) {
    case "all":
      return true;
    case "open":
      return issue.state === "open" && !dismissed && !snoozed;
    case "dismissed":
      return dismissed;
    case "snoozed":
      return snoozed;
    case "urgent":
      return priority !== null && priority <= 1;
  }
}

/** Applies a filter to a list of issues, returning a new array. */
export function filterIssues(issues: IssueWithTriage[], filter: IssueFilter): IssueWithTriage[] {
  return filter === "all" ? issues : issues.filter((issue) => matchesIssueFilter(issue, filter));
}
