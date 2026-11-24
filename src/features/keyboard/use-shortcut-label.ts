"use client";

import { useSyncExternalStore } from "react";
import {
  formatKeyValue,
  getServerShortcutOverridesSnapshot,
  getShortcutOverridesSnapshot,
  shortcuts,
  subscribeToShortcutOverrides,
} from "./shortcut-registry";

/**
 * The display label for one shortcut, including user overrides.
 *
 * The override map is read through `useSyncExternalStore` with a server
 * snapshot that is empty. The first client render therefore matches the server
 * markup, and saved overrides arrive after hydration instead of causing a
 * mismatch in the keycaps.
 *
 * @param id - The shortcut id.
 * @returns The formatted key, or an empty string when the id is unknown.
 */
export function useShortcutLabel(id: string): string {
  const overrides = useSyncExternalStore(
    subscribeToShortcutOverrides,
    getShortcutOverridesSnapshot,
    getServerShortcutOverridesSnapshot
  );
  const shortcut = shortcuts.find((item) => item.id === id);
  if (!shortcut) return "";
  const override = overrides[shortcut.id];
  return formatKeyValue(
    shortcut,
    typeof override === "string" && override.length > 0 ? override : shortcut.key
  );
}
