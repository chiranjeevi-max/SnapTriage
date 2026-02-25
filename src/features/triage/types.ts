import type { IssueUpdate } from "@/lib/provider-interface";

/** What the user wants to change on an issue */
export interface TriagePayload {
  priority?: number | null;
  snoozedUntil?: string | null; // ISO string or null
  dismissed?: boolean;
  labels?: { add?: string[]; remove?: string[] };
  assignees?: { add?: string[]; remove?: string[] };
  state?: "open" | "closed";
}

/** A single triage action with context for undo */
export interface TriageAction {
  issueId: string;
  payload: TriagePayload;
  previousPayload: TriagePayload;
  description: string;
}

/** Pending changes stored in the DB for batch mode */
export interface PendingChanges {
  priority?: number | null;
  snoozedUntil?: string | null;
  dismissed?: boolean;
  labels?: { add: string[]; remove: string[] };
  assignees?: { add: string[]; remove: string[] };
  state?: "open" | "closed";
}

/** Merge a new payload into existing pending changes */
export function mergePendingChanges(
  existing: PendingChanges,
  incoming: TriagePayload
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

    for (const l of incoming.labels.add ?? []) {
      removeSet.delete(l); // cancel pending removal
      addSet.add(l);
    }
    for (const l of incoming.labels.remove ?? []) {
      if (addSet.has(l)) {
        addSet.delete(l); // cancel pending addition — no need to remove what was never applied
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

    for (const a of incoming.assignees.add ?? []) {
      removeSet.delete(a);
      addSet.add(a);
    }
    for (const a of incoming.assignees.remove ?? []) {
      if (addSet.has(a)) {
        addSet.delete(a);
      } else {
        removeSet.add(a);
      }
    }

    merged.assignees = { add: [...addSet], remove: [...removeSet] };
  }

  return merged;
}

/** Convert a TriagePayload to an IssueUpdate for provider writeback */
export function payloadToIssueUpdate(payload: TriagePayload): IssueUpdate {
  const update: IssueUpdate = {};
  if (payload.labels) update.labels = payload.labels;
  if (payload.assignees) update.assignees = payload.assignees;
  if (payload.state) update.state = payload.state;
  return update;
}
