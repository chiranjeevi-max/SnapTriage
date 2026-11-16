/**
 * @module presets
 * Barrel file that re-exports the public types, hooks, and components of the
 * triage-preset feature. Import from `@/features/presets` rather than reaching
 * into sub-modules directly.
 */

// Types and the pure resolver
export type { Preset, PresetActions, PresetResolution, PreviewChange } from "./types";
export {
  PRESET_LIMIT_PER_REPO,
  PRESET_NAME_LIMIT,
  describeResolution,
  invertResolution,
  resolvePreset,
} from "./types";

// Helpers
export { describeActions, hasPresetActions } from "./preset-actions";
export { readApiError } from "./api-error";

// Hooks
export {
  usePresets,
  useCreatePreset,
  useUpdatePreset,
  useDeletePreset,
  useRepoBatchMode,
} from "./use-presets";
export type { CreatePresetInput, UpdatePresetInput, DeletePresetInput } from "./use-presets";
export { useApplyPreset } from "./use-apply-preset";
export type { ApplyPresetInput, ApplyPresetResult } from "./use-apply-preset";

// Components
export { PresetPicker } from "./components/preset-picker";
