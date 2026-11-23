/**
 * @module inbox/use-local-storage-value
 *
 * A `localStorage`-backed value that does not break hydration.
 *
 * Reading storage in a `useState` initializer runs on the server too, where it
 * returns the fallback, and again on the client during hydration, where it
 * returns the stored value. The two renders disagree, so React logs a hydration
 * error and throws the server tree away — and the user watches the control snap
 * from the default to their saved choice.
 *
 * `useSyncExternalStore` is what exists for this: it takes a separate
 * server snapshot, so the first client render matches the markup, and it
 * subscribes to the value rather than copying it into component state.
 */
"use client";

import { useCallback, useSyncExternalStore } from "react";

/** Listeners keyed by storage key, so one write only notifies its own readers. */
const listeners = new Map<string, Set<() => void>>();

/**
 * Values this tab holds that storage could not keep.
 *
 * A write can fail — a private window, an exhausted quota — and reporting the
 * failure by reverting the control would look like the click did nothing. The
 * value still applies for this session, and the next successful write to the
 * same key supersedes it.
 */
const unsaved = new Map<string, string>();

function subscribe(key: string, listener: () => void): () => void {
  const existing = listeners.get(key) ?? new Set();
  existing.add(listener);
  listeners.set(key, existing);

  // Another tab writing the same key is a change this tab should see too.
  const onStorage = (event: StorageEvent) => {
    if (event.key === key) listener();
  };
  window.addEventListener("storage", onStorage);

  return () => {
    existing.delete(listener);
    if (existing.size === 0) listeners.delete(key);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    // A value this tab wrote but storage refused takes precedence over whatever
    // stale value is still on disk.
    return unsaved.get(key) ?? stored;
  } catch {
    // Storage can throw in a private window or when the quota is exhausted.
    // The fallback is the honest answer, not a crash.
    return unsaved.get(key) ?? null;
  }
}

/**
 * Persist a value in `localStorage`.
 *
 * @param key - The full storage key.
 * @param fallback - The value when storage is unset or holds something unusable.
 * @param parse - Narrows a stored string to the value type. Must return the same
 *                primitive for the same input, since it runs on every read.
 * @returns The current value and a setter that also persists it.
 */
export function useLocalStorageValue<T extends string>(
  key: string,
  fallback: T,
  parse: (stored: string | null) => T = (stored) => (stored as T | null) ?? fallback
): [T, (next: T) => void] {
  const value = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(key, listener), [key]),
    useCallback(() => parse(read(key)), [key, parse]),
    // The server has no storage, so both the server render and the hydration
    // render see the fallback and agree.
    () => fallback
  );

  const update = useCallback(
    (next: T) => {
      try {
        window.localStorage.setItem(key, next);
        unsaved.delete(key);
      } catch {
        // A write that cannot persist still applies for this session, so the
        // control does not silently revert under the user.
        unsaved.set(key, next);
      }
      for (const listener of listeners.get(key) ?? []) listener();
    },
    [key]
  );

  return [value, update];
}
