/**
 * @vitest-environment jsdom
 * @module tests/unit/features/inbox/use-local-storage-value
 *
 * The storage-backed hooks feed controlled inputs, so the first client render
 * must match the server's. Reading storage during render makes the two disagree
 * and React discards the server tree.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLocalStorageValue } from "@/features/inbox/use-local-storage-value";

const KEY = "snaptriage:test-value";

describe("useLocalStorageValue", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  /**
   * @target useLocalStorageValue
   * @dependencies localStorage
   * @scenario Storage already holds a value when the component mounts
   * @expectedOutput The stored value, so a reload restores the user's choice
   */
  it("reads a stored value", () => {
    window.localStorage.setItem(KEY, "stored");

    const { result } = renderHook(() => useLocalStorageValue<string>(KEY, "fallback"));

    expect(result.current[0]).toBe("stored");
  });

  /**
   * @target useLocalStorageValue
   * @dependencies localStorage
   * @scenario Storage holds something the parser rejects
   * @expectedOutput The fallback rather than an unusable value
   */
  it("falls back when the stored value is unusable", () => {
    window.localStorage.setItem(KEY, "nonsense");

    const { result } = renderHook(() =>
      useLocalStorageValue<string>(KEY, "fallback", (stored) =>
        stored === "good" ? "good" : "fallback"
      )
    );

    expect(result.current[0]).toBe("fallback");
  });

  it("persists an update and re-reads it", () => {
    const { result, rerender } = renderHook(() => useLocalStorageValue<string>(KEY, "first"));

    act(() => result.current[1]("second"));

    expect(result.current[0]).toBe("second");
    expect(window.localStorage.getItem(KEY)).toBe("second");

    rerender();
    expect(result.current[0]).toBe("second");
  });

  /**
   * @target useLocalStorageValue
   * @dependencies localStorage
   * @scenario Storage throws, as a private window or an exhausted quota does
   * @expectedOutput The fallback, and a write still updates this tab. A throw
   *                 here would unmount the inbox rather than lose a preference.
   */
  it("survives storage being unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const { result } = renderHook(() => useLocalStorageValue<string>(KEY, "fallback"));

    expect(result.current[0]).toBe("fallback");
    expect(() => act(() => result.current[1]("next"))).not.toThrow();
    expect(result.current[0]).toBe("next");
  });
});
