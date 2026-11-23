/**
 * @module triage/types
 * Core type definitions and utility functions for the triage system.
 * Defines the shape of triage payloads, actions, and pending batch changes,
 * along with helpers for merging changes and converting payloads to provider updates.
 */
import type { IssueUpdate } from "@/lib/provider-interface";

/**
 * Describes what the user wants to change on an issue.
 * Each field is optional -- only fields present will be applied.
 *
 * @property priority - Numeric priority level, or `null` to clear.
 * @property snoozedUntil - ISO 8601 date string for snooze expiry, or `null` to unsnooze.
 * @property dismissed - Whether the issue should be dismissed from the inbox.
 * @property labels - Labels to add and/or remove.
 * @property assignees - Assignees to add and/or remove.
 * @property state - Desired issue state (`"open"` or `"closed"`).
 */
export interface TriagePayload {
  priority?: number | null;
  snoozedUntil?: string | null; // ISO string or null
  dismissed?: boolean;
  labels?: { add?: string[]; remove?: string[] };
  assignees?: { add?: string[]; remove?: string[] };
  state?: "open" | "closed";
}

/**
 * A single triage action bundled with context needed to undo it.
 *
 * @property issueId - The ID of the issue being triaged.
 * @property payload - The changes being applied.
 * @property previousPayload - The inverse payload used to revert the action.
 * @property description - Human-readable summary shown in toasts and the undo stack.
 */
export interface TriageAction {
  issueId: string;
  payload: TriagePayload;
  previousPayload: TriagePayload;
  description: string;
}

/**
 * Accumulated pending changes stored in the database for batch mode.
 * Unlike {@link TriagePayload}, label and assignee arrays are required (non-optional)
 * because pending changes are always fully resolved after merging.
 *
 * @property priority - Numeric priority level, or `null` to clear.
 * @property snoozedUntil - ISO 8601 date string for snooze expiry, or `null` to unsnooze.
 * @property dismissed - Whether the issue should be dismissed.
 * @property labels - Resolved label additions and removals.
 * @property assignees - Resolved assignee additions and removals.
 * @property state - Desired issue state (`"open"` or `"closed"`).
 */
export interface PendingChanges {
  priority?: number | null;
  snoozedUntil?: string | null;
  dismissed?: boolean;
  labels?: { add: string[]; remove: string[] };
  assignees?: { add: string[]; remove: string[] };
  state?: "open" | "closed";
}

/**
 * Merge a new triage payload into existing pending changes.
 * Handles deduplication and cancellation logic for labels and assignees
 * (e.g., adding a label that was pending removal cancels the removal).
 *
 * `appliedLabels` is the set of labels the issue actually carries upstream. It is
 * needed for one case the diff alone cannot express: a removal of a label that is
 * currently staged as an addition. That is a no-op when the label was never
 * applied, but it is a real removal when it was — which is exactly the state the
 * undo of a preset creates, having cancelled a staged removal with an addition.
 *
 * @param existing - The current accumulated pending changes.
 * @param incoming - The new payload to merge in.
 * @param appliedLabels - Labels the issue carries upstream, for the case above.
 * @param appliedAssignees - Assignees the issue carries upstream, same rule.
 * @returns A new {@link PendingChanges} object with the incoming changes folded in.
 */
export function mergePendingChanges(
  existing: PendingChanges,
  incoming: TriagePayload,
  appliedLabels: readonly string[] = [],
  appliedAssignees: readonly string[] = []
): PendingChanges {
  const merged = { ...existing };

  if (incoming.priority !== undefined) merged.priority = incoming.priority;
  if (incoming.snoozedUntil !== undefined) merged.snoozedUntil = incoming.snoozedUntil;
  if (incoming.dismissed !== undefined) merged.dismissed = incoming.dismissed;
  if (incoming.state !== undefined) merged.state = incoming.state;

  if (incoming.labels) {
    const prev = merged.labels ?? { add: [], remove: [] };
    const addSet = new Set(prev.add);
    const removeSet = new Set(prev.remove);

    // Every comparison here is case-insensitive, like `resolvePreset`. GitHub and
    // GitLab treat `Bug` and `bug` as one label, so a case-sensitive comparison
    // would leave a staged removal in place for a label the preset had just
    // added — and the push would then remove what the user applied.
    for (const l of incoming.labels.add ?? []) {
      for (const pending of [...removeSet]) {
        if (pending.toLowerCase() === l.toLowerCase()) removeSet.delete(pending);
      }
      // One entry per label whatever its casing. Staging `bug` then `Bug` must not
      // leave both, or a later removal of `bug` cancels only the first and the
      // other still reaches the provider.
      for (const pending of [...addSet]) {
        if (pending.toLowerCase() === l.toLowerCase()) addSet.delete(pending);
      }
      addSet.add(l);
    }
    for (const l of incoming.labels.remove ?? []) {
      // Every case variant, not only the first. `find` would leave a second
      // variant staged as an addition, so the removal could not take effect.
      const pendingAdds = [...addSet].filter(
        (candidate) => candidate.toLowerCase() === l.toLowerCase()
      );
      const wasApplied = appliedLabels.some((applied) => applied.toLowerCase() === l.toLowerCase());
      if (pendingAdds.length > 0) {
        // Cancels the pending addition: the label never needs to reach the
        // provider as an addition.
        for (const pending of pendingAdds) addSet.delete(pending);
        // It still needs to reach the provider as a *removal* when the issue
        // already carries it. That is the undo of a preset that cancelled a
        // staged removal, and dropping it left the label on the issue at push.
        if (wasApplied) removeSet.add(l);
      } else {
        removeSet.add(l);
      }
    }

    merged.labels = { add: [...addSet], remove: [...removeSet] };
  }

  if (incoming.assignees) {
    const prev = merged.assignees ?? { add: [], remove: [] };
    const addSet = new Set(prev.add);
    const removeSet = new Set(prev.remove);

    // The same case-insensitive rule as labels: GitHub and GitLab treat `Jo` and
    // `jo` as one account, so a case-sensitive comparison would leave a pending
    // addition beside the removal that was meant to cancel it.
    for (const a of incoming.assignees.add ?? []) {
      for (const pending of [...removeSet]) {
        if (pending.toLowerCase() === a.toLowerCase()) removeSet.delete(pending);
      }
      for (const pending of [...addSet]) {
        if (pending.toLowerCase() === a.toLowerCase()) addSet.delete(pending);
      }
      addSet.add(a);
    }
    for (const a of incoming.assignees.remove ?? []) {
      const pendingAdds = [...addSet].filter(
        (candidate) => candidate.toLowerCase() === a.toLowerCase()
      );
      const wasApplied = appliedAssignees.some(
        (applied) => applied.toLowerCase() === a.toLowerCase()
      );
      if (pendingAdds.length > 0) {
        // Cancels the pending addition, exactly as the label branch does.
        for (const pending of pendingAdds) addSet.delete(pending);
        // It is still a real removal when the issue already carries the login.
        if (wasApplied) removeSet.add(a);
      } else {
        removeSet.add(a);
      }
    }

    merged.assignees = { add: [...addSet], remove: [...removeSet] };
  }

  return merged;
}

/**
 * Convert a {@link TriagePayload} to an {@link IssueUpdate} suitable for
 * provider writeback. Only provider-relevant fields (labels, assignees, state)
 * are included; local-only fields like priority and snoozedUntil are omitted.
 *
 * @param payload - The triage payload to convert.
 * @returns An {@link IssueUpdate} containing only the fields the provider API needs.
 */
export function payloadToIssueUpdate(payload: TriagePayload): IssueUpdate {
  const update: IssueUpdate = {};

  // A pair whose both sides cancelled out is not a change. Keeping it would make
  // `Object.keys(update).length` non-zero, so a push with nothing to send still
  // called the provider, and the batch preview could not distinguish a real diff
  // from an emptied one.
  const hasValues = (set?: { add?: string[]; remove?: string[] }) =>
    (set?.add?.length ?? 0) > 0 || (set?.remove?.length ?? 0) > 0;

  if (payload.labels && hasValues(payload.labels)) update.labels = payload.labels;
  if (payload.assignees && hasValues(payload.assignees)) update.assignees = payload.assignees;
  if (payload.state) update.state = payload.state;
  return update;
}
