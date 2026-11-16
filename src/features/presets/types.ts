/**
 * @module presets/types
 *
 * The preset contract.
 *
 * A preset stores a *decision* — the labels, assignees, and personal priority
 * a maintainer reaches for whenever a particular kind of issue arrives — in the
 * same shape the triage API already accepts. Nothing here is a rule: a preset
 * is only ever read because somebody asked for it by name for one issue.
 *
 * Three pieces live in this module:
 *
 * - {@link PresetActions}: the stored, provider-free subset of a triage payload.
 * - {@link resolvePreset}: turns stored actions plus one issue into the exact
 *   change to make, dropping anything the issue already satisfies.
 * - {@link describeResolution}: the human summary shown before anything is
 *   written, so the user approves a diff rather than a promise.
 *
 * Keeping them together keeps the preview and the write path honest: the pane
 * previews with the same function the server applies with.
 */
import type { IssueWithTriage } from "@/features/inbox/use-issues";
import type { TriagePayload } from "@/features/triage/types";

/**
 * The parts of a triage payload a preset may carry.
 *
 * Snooze, dismiss, and state are excluded on purpose. A preset that closed an
 * issue or hid it from the queue would let one keystroke do something the user
 * cannot see in the preview, and "apply my confirmed-bug decision" should
 * never mean "and also close it".
 */
export interface PresetActions {
  /** Personal priority, or `null` to clear it. Omitted leaves it unchanged. */
  priority?: number | null;
  /** Labels to add. Removal is supported by the resolver, not by a stored preset. */
  labels?: { add?: string[] };
  /** Assignees to add. Removal is supported by the resolver, not by a stored preset. */
  assignees?: { add?: string[] };
}

/** One line of a human-readable preview. */
export interface PreviewChange {
  /** Discriminates the icon and the sentence the pane renders. */
  kind: "priority" | "label" | "assignee";
  /** The provider value being added, e.g. a label name or a login. */
  value: string;
  /**
   * A short operator prefix: `+` for something being added, `=` for a value the
   * issue already has (shown so the user can see the preset was considered),
   * and `-` for a clear (`priority: null`).
   */
  operation: "+" | "=" | "-";
}

/**
 * What applying a preset would do to one issue.
 *
 * The `payload` is what gets sent; `changes` is what the user reads. They are
 * derived together so a preview can never advertise a change the payload does
 * not make.
 */
export interface PresetResolution {
  /** The exact change to apply. Empty when the preset is already satisfied. */
  payload: TriagePayload;
  /** The preview lines, in a stable display order. */
  changes: PreviewChange[];
  /** `true` when the issue already satisfies the preset in full. */
  noChange: boolean;
}

/**
 * A stored preset as the API returns it.
 *
 * `actions` is already parsed and validated, so consumers never deal with the
 * raw JSON column.
 */
export interface Preset {
  id: string;
  repoId: string;
  name: string;
  actions: PresetActions;
  createdAt: string;
  updatedAt: string;
}

/** Maximum number of presets a user may keep per repository. */
export const PRESET_LIMIT_PER_REPO = 100;

/** Maximum length of a preset name, matching the saved-view limit. */
export const PRESET_NAME_LIMIT = 80;

/**
 * A minimal issue view the resolver needs.
 *
 * Declared structurally rather than as {@link IssueWithTriage} so the resolver
 * can run against a fixture, a cached row, or a freshly fetched issue without a
 * cast. Only the three fields a preset can touch are read.
 */
export type ResolvableIssue = Pick<IssueWithTriage, "labels" | "assignees"> & {
  triage?: { priority: number | null } | null;
};

/**
 * Build the change a preset makes to one issue.
 *
 * The preset only ever *adds*. Anything the issue already has is reported as
 * unchanged and left out of the payload, which is what makes a second
 * application a no-op instead of a duplicate provider call, and what keeps
 * undo from removing a label the issue had before the preset ran.
 *
 * @param actions - The stored preset actions.
 * @param issue - The issue the preset would be applied to.
 * @returns The payload to send, the preview lines, and whether anything changes.
 */
export function resolvePreset(actions: PresetActions, issue: ResolvableIssue): PresetResolution {
  const payload: TriagePayload = {};
  const changes: PreviewChange[] = [];

  if (actions.priority !== undefined) {
    const current = issue.triage?.priority ?? null;
    if (current === actions.priority) {
      if (actions.priority !== null) {
        changes.push({ kind: "priority", value: `P${actions.priority}`, operation: "=" });
      }
    } else if (actions.priority === null) {
      if (current !== null) {
        payload.priority = null;
        changes.push({ kind: "priority", value: `P${current}`, operation: "-" });
      }
    } else {
      payload.priority = actions.priority;
      changes.push({ kind: "priority", value: `P${actions.priority}`, operation: "+" });
    }
  }

  const existingLabels = new Set(issue.labels.map((label) => label.toLowerCase()));
  const labelsToAdd: string[] = [];
  for (const label of actions.labels?.add ?? []) {
    if (existingLabels.has(label.toLowerCase())) {
      changes.push({ kind: "label", value: label, operation: "=" });
    } else {
      labelsToAdd.push(label);
      existingLabels.add(label.toLowerCase());
      changes.push({ kind: "label", value: label, operation: "+" });
    }
  }
  if (labelsToAdd.length > 0) payload.labels = { add: labelsToAdd };

  const existingAssignees = new Set(issue.assignees.map((login) => login.toLowerCase()));
  const assigneesToAdd: string[] = [];
  for (const login of actions.assignees?.add ?? []) {
    if (existingAssignees.has(login.toLowerCase())) {
      changes.push({ kind: "assignee", value: login, operation: "=" });
    } else {
      assigneesToAdd.push(login);
      existingAssignees.add(login.toLowerCase());
      changes.push({ kind: "assignee", value: login, operation: "+" });
    }
  }
  if (assigneesToAdd.length > 0) payload.assignees = { add: assigneesToAdd };

  return {
    payload,
    changes,
    noChange: Object.keys(payload).length === 0,
  };
}

/**
 * Render a resolution as one sentence for a toast or a preview header.
 *
 * @param resolution - The resolution to describe.
 * @returns A summary such as `Add bug, Assign jo, Set P1`, or a no-op sentence.
 */
export function describeResolution(resolution: PresetResolution): string {
  if (resolution.noChange) return "Already matches this preset";

  const parts: string[] = [];
  for (const change of resolution.changes) {
    if (change.operation === "=") continue;
    if (change.kind === "priority") {
      parts.push(change.operation === "-" ? "Clear priority" : `Set ${change.value}`);
    } else if (change.kind === "label") {
      parts.push(`Add ${change.value}`);
    } else {
      parts.push(`Assign ${change.value}`);
    }
  }
  return parts.join(", ");
}

/**
 * Assemble the inverse payload for undoing a resolution.
 *
 * Only fields the preset actually changed are inverted, so an undo can never
 * remove a label or assignment the issue already had. This is the reason
 * {@link resolvePreset} reports additions rather than a desired end state.
 *
 * @param resolution - The resolution that was applied.
 * @param before - The issue as it was before the application.
 * @returns The payload that restores the previous values.
 */
export function invertResolution(
  resolution: PresetResolution,
  before: ResolvableIssue
): TriagePayload {
  const inverse: TriagePayload = {};

  if (resolution.payload.priority !== undefined) {
    inverse.priority = before.triage?.priority ?? null;
  }

  const addedLabels = resolution.payload.labels?.add ?? [];
  if (addedLabels.length > 0) {
    inverse.labels = { add: [], remove: addedLabels };
  }

  const addedAssignees = resolution.payload.assignees?.add ?? [];
  if (addedAssignees.length > 0) {
    inverse.assignees = { add: [], remove: addedAssignees };
  }

  return inverse;
}
