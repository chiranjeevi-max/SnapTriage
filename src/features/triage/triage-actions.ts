/**
 * @module triage/triage-actions
 * Builder functions that construct {@link TriagePayload} objects for common
 * triage operations. Each function returns a minimal payload representing
 * a single action (set priority, add/remove label, assign/unassign, snooze, dismiss).
 */
import type { TriagePayload } from "./types";

/**
 * Create a payload that sets (or clears) the priority on an issue.
 *
 * @param priority - The priority level to set, or `null` to clear priority.
 * @returns A {@link TriagePayload} with the `priority` field set.
 */
export function setPriority(priority: number | null): TriagePayload {
  return { priority };
}

/**
 * Create a payload that adds a single label to an issue.
 *
 * @param label - The label name to add.
 * @returns A {@link TriagePayload} with `labels.add` containing the given label.
 */
export function addLabel(label: string): TriagePayload {
  return { labels: { add: [label], remove: [] } };
}

/**
 * Create a payload that removes a single label from an issue.
 *
 * @param label - The label name to remove.
 * @returns A {@link TriagePayload} with `labels.remove` containing the given label.
 */
export function removeLabel(label: string): TriagePayload {
  return { labels: { add: [], remove: [label] } };
}

/**
 * Create a payload that assigns a user to an issue.
 *
 * @param username - The username to assign.
 * @returns A {@link TriagePayload} with `assignees.add` containing the given username.
 */
export function assignUser(username: string): TriagePayload {
  return { assignees: { add: [username], remove: [] } };
}

/**
 * Create a payload that unassigns a user from an issue.
 *
 * @param username - The username to unassign.
 * @returns A {@link TriagePayload} with `assignees.remove` containing the given username.
 */
export function unassignUser(username: string): TriagePayload {
  return { assignees: { add: [], remove: [username] } };
}

/**
 * Create a payload that snoozes an issue until a specific date/time.
 *
 * @param until - ISO 8601 date string indicating when the snooze expires.
 * @returns A {@link TriagePayload} with `snoozedUntil` set.
 */
export function snoozeIssue(until: string): TriagePayload {
  return { snoozedUntil: until };
}

/**
 * Create a payload that unsnoozes an issue (clears the snooze timer).
 *
 * @returns A {@link TriagePayload} with `snoozedUntil` set to `null`.
 */
export function unsnoozeIssue(): TriagePayload {
  return { snoozedUntil: null };
}

/**
 * Create a payload that dismisses or un-dismisses an issue.
 *
 * @param dismissed - `true` to dismiss, `false` to un-dismiss.
 * @returns A {@link TriagePayload} with the `dismissed` field set.
 */
export function dismissIssue(dismissed: boolean): TriagePayload {
  return { dismissed };
}

/** The issue states a triage write can set. */
export type IssueState = "open" | "closed";

/**
 * Resolve what one keystroke should do to an issue's open/closed state.
 *
 * Closing is the direction a triage session usually wants and reopening is the
 * correction, so one key covers both rather than spending two. The inverse is
 * returned alongside the payload because that is what undo replays, and
 * deriving it here keeps the two from drifting apart.
 *
 * @param current - The issue's state as last read from the server.
 * @returns The forward payload, the payload that reverses it, and a description
 *          naming the direction so the toast is not ambiguous.
 */
export function toggleIssueState(current: IssueState): {
  payload: TriagePayload;
  previousPayload: TriagePayload;
  description: string;
} {
  const next: IssueState = current === "open" ? "closed" : "open";

  return {
    payload: { state: next },
    previousPayload: { state: current },
    description: next === "closed" ? "Closed issue" : "Reopened issue",
  };
}
