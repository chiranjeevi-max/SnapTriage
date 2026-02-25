import type { TriagePayload } from "./types";

/** Set priority on an issue (pass null to clear) */
export function setPriority(priority: number | null): TriagePayload {
  return { priority };
}

/** Add a label to an issue */
export function addLabel(label: string): TriagePayload {
  return { labels: { add: [label], remove: [] } };
}

/** Remove a label from an issue */
export function removeLabel(label: string): TriagePayload {
  return { labels: { add: [], remove: [label] } };
}

/** Assign a user to an issue */
export function assignUser(username: string): TriagePayload {
  return { assignees: { add: [username], remove: [] } };
}

/** Unassign a user from an issue */
export function unassignUser(username: string): TriagePayload {
  return { assignees: { add: [], remove: [username] } };
}

/** Snooze an issue until a given time (ISO string) */
export function snoozeIssue(until: string): TriagePayload {
  return { snoozedUntil: until };
}

/** Unsnooze an issue */
export function unsnoozeIssue(): TriagePayload {
  return { snoozedUntil: null };
}

/** Dismiss or undismiss an issue */
export function dismissIssue(dismissed: boolean): TriagePayload {
  return { dismissed };
}
