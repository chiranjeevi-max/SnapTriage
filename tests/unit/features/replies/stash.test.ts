// @vitest-environment jsdom
/**
 * @module tests/unit/features/replies/stash
 *
 * Unit tests for the recovered-text store behind the composer's recovery banner.
 *
 * The copy exists for the case where an unmount flush could not save the user's
 * prose. Two properties matter and are held here: it must survive a reload (the
 * module boundary is not enough), and it must stay bounded when the user
 * abandons drafts on issue after issue.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setStashed, stashSnapshot, subscribeToStash } from "@/features/replies/stash";

const KEY_PREFIX = "snaptriage:reply-stash:";
const INDEX_KEY = "snaptriage:reply-stash:index";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("stash", () => {
  /**
   * @target setStashed, stashSnapshot
   * @dependencies sessionStorage
   * @scenario An unmount flush fails and writes the text
   * @expectedOutput The same issue reads it back and subscribers are woken
   */
  it("should return text written for the same issue and notify subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToStash(listener);

    setStashed("issue-a", "half-written reply");

    expect(stashSnapshot("issue-a")).toBe("half-written reply");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  /**
   * @target stashSnapshot
   * @dependencies sessionStorage
   * @scenario The document reloads, so module memory is gone
   * @expectedOutput The text is read back from the tab's storage. Without this,
   *                 the recovery banner only worked within one document, which
   *                 is not when a failed flush is most likely.
   */
  it("should survive a module reload", async () => {
    setStashed("issue-reload", "survives a refresh");

    vi.resetModules();
    const reloaded = await import("@/features/replies/stash");

    expect(reloaded.stashSnapshot("issue-reload")).toBe("survives a refresh");
  });

  /**
   * @target setStashed
   * @dependencies sessionStorage
   * @scenario Twelve issues keep a copy, more than the cap allows
   * @expectedOutput The two oldest are gone and the newest ten remain, so an
   *                 abandoned draft cannot grow the store for the tab's lifetime
   */
  it("should evict the oldest entry past the cap", () => {
    for (let index = 0; index < 12; index++) {
      setStashed(`issue-cap-${index}`, `text-${index}`);
    }

    expect(stashSnapshot("issue-cap-0")).toBeNull();
    expect(stashSnapshot("issue-cap-1")).toBeNull();
    expect(stashSnapshot("issue-cap-2")).toBe("text-2");
    expect(stashSnapshot("issue-cap-11")).toBe("text-11");
    expect(window.sessionStorage.getItem(`${KEY_PREFIX}issue-cap-0`)).toBeNull();
  });

  /**
   * @target setStashed
   * @dependencies sessionStorage
   * @scenario The user answers the recovery banner
   * @expectedOutput The entry is retired from memory and from storage
   */
  it("should clear both copies when the banner is answered", async () => {
    setStashed("issue-clear", "answered");

    setStashed("issue-clear", null);

    expect(stashSnapshot("issue-clear")).toBeNull();
    expect(window.sessionStorage.getItem(`${KEY_PREFIX}issue-clear`)).toBeNull();

    vi.resetModules();
    const reloaded = await import("@/features/replies/stash");
    expect(reloaded.stashSnapshot("issue-clear")).toBeNull();
  });

  /**
   * @target setStashed, stashSnapshot
   * @dependencies sessionStorage
   * @scenario Storage rejects the write (quota or privacy mode)
   * @expectedOutput The in-memory copy still serves the current tab instead of
   *                 losing the text to an exception
   */
  it("should keep the in-memory copy when storage rejects a write", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(() => setStashed("issue-quota", "still here")).not.toThrow();
    expect(stashSnapshot("issue-quota")).toBe("still here");

    spy.mockRestore();
  });

  /**
   * @target stashSnapshot
   * @dependencies sessionStorage
   * @scenario Storage rejects a read
   * @expectedOutput `null` rather than a thrown error: the recovery banner is
   *                 optional, and a locked-down browser must not break the
   *                 composer that is already on screen
   */
  it("should return null when storage refuses a read", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });

    expect(() => stashSnapshot("issue-read-blocked")).not.toThrow();
    expect(stashSnapshot("issue-read-blocked")).toBeNull();

    spy.mockRestore();
  });

  /**
   * @target setStashed
   * @dependencies sessionStorage
   * @scenario Storage is unavailable entirely, so the map is the only copy
   * @expectedOutput The cap still holds. Without this, a browser in privacy mode
   *                 grows the map with every abandoned draft for the tab's life.
   */
  it("should enforce the cap when storage is unavailable", () => {
    const spy = vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    try {
      for (let index = 0; index < 12; index++) {
        setStashed(`issue-nostore-${index}`, `text-${index}`);
      }

      expect(stashSnapshot("issue-nostore-0")).toBeNull();
      expect(stashSnapshot("issue-nostore-1")).toBeNull();
      expect(stashSnapshot("issue-nostore-2")).toBe("text-2");
      expect(stashSnapshot("issue-nostore-11")).toBe("text-11");
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * @target setStashed
   * @dependencies sessionStorage
   * @scenario The eviction index is lost while stored copies remain
   * @expectedOutput The next write still caps the map and retires the oldest
   *                 key, rather than letting a stale index disable eviction
   */
  it("should cap memory when the eviction index is lost", () => {
    for (let index = 0; index < 10; index++) {
      setStashed(`issue-index-${index}`, `text-${index}`);
    }
    window.sessionStorage.removeItem(INDEX_KEY);

    setStashed("issue-index-10", "text-10");

    expect(stashSnapshot("issue-index-0")).toBeNull();
    expect(stashSnapshot("issue-index-10")).toBe("text-10");
  });

  /**
   * @target setStashed, readIndex
   * @dependencies sessionStorage
   * @scenario The index is not valid JSON
   * @expectedOutput The write succeeds and rewrites a usable index. A corrupted
   *                 entry must not throw inside the unmount flush's callback.
   */
  it("should recover from a corrupted eviction index", () => {
    window.sessionStorage.setItem(INDEX_KEY, "{not json");

    expect(() => setStashed("issue-corrupt", "text")).not.toThrow();
    expect(stashSnapshot("issue-corrupt")).toBe("text");
    expect(JSON.parse(window.sessionStorage.getItem(INDEX_KEY) ?? "[]")).toEqual([
      "issue-corrupt",
    ]);
  });

  /**
   * @target setStashed, readIndex
   * @dependencies sessionStorage
   * @scenario The index repeats an id and contains a non-string entry
   * @expectedOutput The duplicate is collapsed and the non-string is ignored,
   *                 so eviction counts real entries only
   */
  it("should clean duplicate and invalid index entries", () => {
    window.sessionStorage.setItem(INDEX_KEY, JSON.stringify(["issue-dup", "issue-dup", 42]));

    setStashed("issue-dup", "text");

    expect(JSON.parse(window.sessionStorage.getItem(INDEX_KEY) ?? "[]")).toEqual(["issue-dup"]);
  });
});
