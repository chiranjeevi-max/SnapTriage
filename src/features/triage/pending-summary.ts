/**
 * @module triage/pending-summary
 *
 * What a batch push will actually do, derived from the staged diffs already on
 * the queue.
 *
 * The batch bar knew only a count, so the app's most irreversible provider write
 * was the one the user could not inspect. Folding the staged changes into one
 * summary lets the bar say what is about to leave the machine before it leaves.
 */
import type { PendingChanges } from "./types";

/** One repository's staged work, already folded together. */
export interface PendingSummary {
  /** Issues marked batch-pending, so the push will clear this many rows. */
  issues: number;
  /** Label names to add, de-duplicated case-insensitively, in staging order. */
  labelsToAdd: string[];
  labelsToRemove: string[];
  assigneesToAdd: string[];
  assigneesToRemove: string[];
  /** Issues that will be closed or reopened. */
  stagedStates: number;
  /** Issues whose priority will change. */
  stagedPriorities: number;
}

/**
 * Add a value to a list unless it is already there, comparing case-insensitively.
 *
 * GitHub and GitLab treat `Bug` and `bug` as one label, so collecting both would
 * describe a push that sends the same value twice.
 */
function addUnique(list: string[], value: string): void {
  if (!list.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
    list.push(value);
  }
}

/**
 * Fold the staged changes of a queue into one summary.
 *
 * @param issues - The queue as loaded, with each issue's `pendingChanges`.
 * @returns What a push would send. Issues with nothing staged contribute nothing,
 *          so the result is safe to derive from the whole queue rather than a
 *          pre-filtered subset.
 */
export function summarizePending(pendingChanges: PendingChanges[]): PendingSummary {
  const summary: PendingSummary = {
    issues: 0,
    labelsToAdd: [],
    labelsToRemove: [],
    assigneesToAdd: [],
    assigneesToRemove: [],
    stagedStates: 0,
    stagedPriorities: 0,
  };

  // One entry per batch-pending row, which is exactly what the push selects. The
  // caller passes the staged diffs themselves rather than the loaded queue,
  // because the queue holds open issues only and a closed issue's staged change
  // is still pushed.
  for (const pending of pendingChanges) {
    summary.issues++;

    for (const label of pending.labels?.add ?? []) addUnique(summary.labelsToAdd, label);
    for (const label of pending.labels?.remove ?? []) addUnique(summary.labelsToRemove, label);
    for (const assignee of pending.assignees?.add ?? []) {
      addUnique(summary.assigneesToAdd, assignee);
    }
    for (const assignee of pending.assignees?.remove ?? []) {
      addUnique(summary.assigneesToRemove, assignee);
    }

    if (pending.state !== undefined) summary.stagedStates++;
    if (pending.priority !== undefined) summary.stagedPriorities++;
  }

  return summary;
}

/**
 * Whether a summary describes a push with anything to send.
 *
 * @param summary - The folded summary.
 * @returns `false` when the push would be a no-op, such as a staged diff whose
 *          every value cancelled out.
 */
export function hasProviderChanges(summary: PendingSummary): boolean {
  return (
    summary.labelsToAdd.length > 0 ||
    summary.labelsToRemove.length > 0 ||
    summary.assigneesToAdd.length > 0 ||
    summary.assigneesToRemove.length > 0 ||
    summary.stagedStates > 0
  );
}

/** One human-readable line of a summary, for the batch bar. */
export interface SummaryLine {
  label: string;
  values: string[];
}

/**
 * Render a summary as the lines the batch bar shows.
 *
 * @param summary - The folded summary.
 * @param maxValues - How many values to list per line before saying "and N more".
 * @returns Ordered lines, most consequential first. Empty when nothing is staged.
 */
export function describePending(summary: PendingSummary, maxValues = 3): SummaryLine[] {
  const lines: SummaryLine[] = [];

  const named = (verb: string, values: string[]): SummaryLine | null => {
    if (values.length === 0) return null;
    const shown = values.slice(0, maxValues);
    if (values.length > maxValues) {
      shown.push(`+${values.length - maxValues} more`);
    }
    return { label: verb, values: shown };
  };

  // Labels first: they are the change most likely to be noticed downstream, and
  // the one a maintainer is most likely to have staged by accident.
  const labelLines = [
    named("Add labels", summary.labelsToAdd),
    named("Remove labels", summary.labelsToRemove),
  ];
  const assigneeLines = [
    named("Assign", summary.assigneesToAdd),
    named("Unassign", summary.assigneesToRemove),
  ];
  for (const line of [...labelLines, ...assigneeLines]) {
    if (line) lines.push(line);
  }

  if (summary.stagedStates > 0) {
    lines.push({
      label: summary.stagedStates === 1 ? "Change state on 1 issue" : "Change state",
      values: summary.stagedStates === 1 ? [] : [`${summary.stagedStates} issues`],
    });
  }

  // Priority is personal, so it never reaches the provider — but it is still
  // staged work this push clears, and leaving it out made the preview silently
  // understate what the push settles.
  if (summary.stagedPriorities > 0) {
    lines.push({
      label: summary.stagedPriorities === 1 ? "Set priority on 1 issue" : "Set priority",
      values: summary.stagedPriorities === 1 ? [] : [`${summary.stagedPriorities} issues`],
    });
  }

  return lines;
}
