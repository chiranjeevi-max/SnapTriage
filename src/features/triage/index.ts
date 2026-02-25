/**
 * @module triage
 * Barrel file that re-exports all public types, action builders, hooks,
 * and components from the triage feature. Import from `@/features/triage`
 * rather than reaching into sub-modules directly.
 */

// Types
export type { TriagePayload, TriageAction, PendingChanges } from "./types";
export { mergePendingChanges, payloadToIssueUpdate } from "./types";

// Action builders
export {
  setPriority,
  addLabel,
  removeLabel,
  assignUser,
  unassignUser,
  snoozeIssue,
  unsnoozeIssue,
  dismissIssue,
} from "./triage-actions";

// Hooks
export { useTriageMutation } from "./use-triage-mutation";
export { useUndoStore, showUndoToast } from "./use-undo";
export { useBatchPush, usePendingBatchCount } from "./use-batch";
export { useRepoLabels } from "./use-repo-labels";
export { useRepoCollaborators } from "./use-repo-collaborators";

// Components
export { LabelPicker } from "./components/label-picker";
export { AssigneePicker } from "./components/assignee-picker";
export { SnoozePicker } from "./components/snooze-picker";
export { BatchStatusBar } from "./components/batch-status-bar";
export { SyncStatus } from "./components/sync-status";
