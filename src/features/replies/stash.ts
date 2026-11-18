/**
 * @module replies/stash
 *
 * Text an unmount flush could not save, kept where the next visit can offer it.
 *
 * The composer that owned the text is gone by the time the request settles, so
 * the copy has to live outside it. A failed flush happens during a soft
 * navigation: React runs the unmount cleanup, the save is refused or dropped,
 * and the component that could show it is already gone. Module memory carries
 * the copy across that navigation, but a later reload or hard navigation
 * destroys it. Mirroring the value into `sessionStorage` is what keeps the offer
 * reachable after that reload. Storage is per tab and cleared when the tab
 * closes, which matches the lifetime of the recovery offer and keeps one issue's
 * unsent prose out of another tab's composer.
 *
 * The in-memory map is still the source the subscription reads. It keeps the
 * `useSyncExternalStore` snapshot stable, and it is the only copy available when
 * storage is disabled or throws.
 */

const KEY_PREFIX = "snaptriage:reply-stash:";

/** Insertion order for eviction, oldest first. */
const INDEX_KEY = "snaptriage:reply-stash:index";

/**
 * How many issues keep a recovered copy.
 *
 * An entry is normally removed when the user answers its banner. One for an
 * issue they never revisit would otherwise live until the tab closes, so the
 * oldest is dropped. The cap is enforced on the in-memory map, not only on
 * storage: when storage is unavailable the map is the only copy, and an
 * abandoned draft must not grow it without bound.
 */
const MAX_ENTRIES = 10;

const memory = new Map<string, string>();
const listeners = new Set<() => void>();

/**
 * The ids the stored index says are live, or `null` before the index is read.
 *
 * This is what makes a successful retirement authoritative even when
 * `removeItem` fails: the key may still be readable, but the index no longer
 * names it, so it is not offered again. `null` means the index is missing or
 * unreadable, which is different from an empty one: the order is unknown, so a
 * stored key is still recoverable.
 */
let liveIds: Set<string> | null = null;

/** The tab's storage, or `null` when it is unavailable or access throws. */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Reads the eviction order, or `null` when the index is missing or unreadable.
 *
 * `null` and `[]` are not interchangeable here. An empty index is a valid,
 * authoritative statement that nothing is live; a missing one means the order
 * is unknown and a stored key may still be recoverable.
 */
function readIndexOrNull(store: Storage): string[] | null {
  try {
    const raw = store.getItem(INDEX_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : null;
  } catch {
    return null;
  }
}

/** Reads the eviction order, treating a missing index as empty. */
function readIndex(store: Storage): string[] {
  return readIndexOrNull(store) ?? [];
}

/**
 * Load the stored entries into memory in their write order.
 *
 * The index is the only record of that order, and the cap evicts by memory
 * order. Restoring entries as they are read would make the most recently read
 * draft look like the newest write, so a later write would evict the wrong one.
 * Runs once per module instance; a missing or unreadable index is retried on the
 * next call rather than treated as an empty order.
 */
function hydrate(store: Storage): void {
  if (liveIds !== null) return;

  const ids = readIndexOrNull(store);
  if (ids === null) return;

  liveIds = new Set(ids);
  for (const id of ids) {
    if (memory.has(id)) continue;
    try {
      const value = store.getItem(KEY_PREFIX + id);
      if (value !== null) memory.set(id, value);
    } catch {
      // One unreadable entry must not block the rest.
    }
  }
}

function writeIndex(store: Storage, ids: string[]): void {
  liveIds = new Set(ids);
  try {
    store.setItem(INDEX_KEY, JSON.stringify(ids));
  } catch {
    // A full or unavailable store is not a reason to lose the in-memory copy.
  }
}

/**
 * Drop the oldest entries until the cap holds.
 *
 * The map's insertion order is the eviction order, so this works whether or not
 * storage is available. Returns the ids removed so a storage-backed caller can
 * retire their keys as well.
 *
 * @returns The ids evicted from memory, oldest first.
 */
function trimMemory(): string[] {
  const evicted: string[] = [];
  while (memory.size > MAX_ENTRIES) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
    evicted.push(oldest);
  }
  return evicted;
}

/**
 * Write or clear the stashed copy and wake any mounted composer.
 *
 * @param issueId - The issue the text belongs to.
 * @param body - The text, or `null` to retire the entry.
 */
export function setStashed(issueId: string, body: string | null): void {
  const store = storage();
  // Load the stored order before changing it. Without this, a write after a
  // reload would append to whatever the reads happened to populate, and the cap
  // would evict by read order instead of write order.
  if (store) hydrate(store);

  if (body === null) {
    memory.delete(issueId);
    liveIds?.delete(issueId);
    if (store) {
      try {
        store.removeItem(KEY_PREFIX + issueId);
      } catch {
        // Best effort; the index update below is the durable part.
      }
      writeIndex(
        store,
        readIndex(store).filter((id) => id !== issueId)
      );
    }
  } else {
    // Re-insert so the most recent write is last in Map order, which is what the
    // cap evicts by.
    memory.delete(issueId);
    memory.set(issueId, body);
    liveIds?.add(issueId);

    if (store) {
      try {
        store.setItem(KEY_PREFIX + issueId, body);
      } catch {
        // Quota or disabled storage: the in-memory copy still serves this tab.
      }
    }

    const evicted = trimMemory();
    const evictedIds = new Set(evicted);

    if (store) {
      for (const id of evicted) {
        try {
          store.removeItem(KEY_PREFIX + id);
        } catch {
          // The index no longer references it, so it is unreachable either way.
        }
      }

      const ids = readIndex(store).filter((id) => id !== issueId && !evictedIds.has(id));
      ids.push(issueId);
      // The storage index is capped independently: after a reload the map holds
      // only what this tab has read, while the index can still carry the full
      // previous session's list.
      while (ids.length > MAX_ENTRIES) {
        const dropped = ids.shift();
        if (dropped === undefined) break;
        memory.delete(dropped);
        try {
          store.removeItem(KEY_PREFIX + dropped);
        } catch {
          // Already unreachable once it is out of the index.
        }
      }
      writeIndex(store, ids);
    }
  }

  for (const listener of listeners) listener();
}

/**
 * Subscribe to stash changes, so a flush that lands after the composer mounted
 * still reaches it.
 *
 * @param listener - Called whenever an entry is written or retired.
 * @returns The unsubscribe function.
 */
export function subscribeToStash(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The snapshot React compares between renders.
 *
 * A value found only in storage is cached in memory on first read, so the
 * snapshot is a stable string rather than a fresh read on every render.
 *
 * @param issueId - The issue whose recovered text is wanted.
 * @returns The stashed text, or `null`.
 */
export function stashSnapshot(issueId: string): string | null {
  const store = storage();
  if (store) hydrate(store);

  const cached = memory.get(issueId);
  if (cached !== undefined) return cached;

  if (!store) return null;

  // A live index that does not name this issue says the entry was retired, even
  // when `removeItem` failed and the key is still readable. A missing index is
  // different: the order is unknown, so a stored key is still offered rather
  // than discarding text that may be the user's only copy.
  if (liveIds !== null && !liveIds.has(issueId)) return null;

  let value: string | null = null;
  try {
    value = store.getItem(KEY_PREFIX + issueId);
  } catch {
    return null;
  }
  if (value !== null) memory.set(issueId, value);
  return value;
}
