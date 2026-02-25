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
