/**
 * @module presets/preset-actions
 *
 * Reading a stored action bundle without touching an issue.
 *
 * {@link resolvePreset} answers "what would this do here"; these helpers answer
 * "what does this preset contain at all", which is what a list row, the editor's
 * save guard, and the picker's filter need. Keeping them apart stops a list row
 * from having to invent an issue just to describe a preset.
 */
import type { PresetActions } from "./types";
import { providerLimits, type ProviderName } from "@/lib/provider-interface";

/** Values shown inline before a list row falls back to a count. */
const INLINE_VALUES = 3;

/**
 * Check a bundle against the limits of the provider that will receive it.
 *
 * `presetActionsSchema` validates against one generous fixed bound because it
 * runs before the repository is known. Once the repository is known, the real
 * limit does too: GitHub refuses a 51-character label and GitLab accepts 255, so
 * a preset saved against the loose bound could be permanently unapplicable on
 * one of them. Checking here keeps that from being storable in the first place.
 *
 * @param provider - The repository's provider.
 * @param actions - The bundle about to be saved.
 * @returns A message naming the offending limit, or `null` when it fits.
 */
export function providerLimitViolation(provider: string, actions: PresetActions): string | null {
  const limits = providerLimits[provider as ProviderName];
  if (!limits) return null;

  const tooLongLabel = (actions.labels?.add ?? []).find((label) => label.length > limits.label);
  if (tooLongLabel) {
    return `Label names are limited to ${limits.label} characters on ${provider}; "${tooLongLabel}" is longer.`;
  }

  const tooLongLogin = (actions.assignees?.add ?? []).find((login) => login.length > limits.login);
  if (tooLongLogin) {
    return `Logins are limited to ${limits.login} characters on ${provider}; "${tooLongLogin}" is longer.`;
  }

  // GitLab reads a label list as comma-separated, so `bug,urgent` would arrive
  // as two labels. The triage service rejects that at apply time; rejecting it
  // here too keeps a preset from being saved in a state it can never apply.
  if (provider === "gitlab") {
    const commaLabel = (actions.labels?.add ?? []).find((label) => label.includes(","));
    if (commaLabel) {
      return `Label names cannot contain commas on gitlab; "${commaLabel}" does.`;
    }
  }

  return null;
}

/**
 * Reports whether a stored bundle has anything to apply.
 *
 * A clearing priority counts: `priority: null` removes a value, which is a
 * change. An empty object does not, and the picker skips those rows — the
 * server rejects them on write, so one can only arrive from data the API never
 * produced.
 *
 * @param actions - The stored actions.
 * @returns `true` when the preset would do something.
 */
export function hasPresetActions(actions: PresetActions): boolean {
  return (
    actions.priority !== undefined ||
    (actions.labels?.add?.length ?? 0) > 0 ||
    (actions.assignees?.add?.length ?? 0) > 0
  );
}

/**
 * One compact line describing a preset's stored actions.
 *
 * Long bundles collapse to a count so a row stays a row: a hundred labels are
 * evidence the picker holds up, not something to print in a list.
 *
 * @param actions - The stored actions.
 * @returns A summary such as `P1 · bug, triage · jo`.
 */
export function describeActions(actions: PresetActions): string {
  const parts: string[] = [];

  if (actions.priority === null) {
    parts.push("clear priority");
  } else if (actions.priority !== undefined) {
    parts.push(`P${actions.priority}`);
  }

  const labels = actions.labels?.add ?? [];
  if (labels.length > 0) {
    parts.push(labels.length > INLINE_VALUES ? `${labels.length} labels` : labels.join(", "));
  }

  const assignees = actions.assignees?.add ?? [];
  if (assignees.length > 0) {
    parts.push(
      assignees.length > INLINE_VALUES ? `${assignees.length} assignees` : assignees.join(", ")
    );
  }

  return parts.length > 0 ? parts.join(" · ") : "No actions";
}
