/**
 * @module tests/unit/features/keyboard/use-shortcut-label
 *
 * Keycaps follow saved shortcut overrides and reset back to the registry key.
 */
/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useShortcutLabel } from "@/features/keyboard/use-shortcut-label";
import { ShortcutKbd } from "@/features/keyboard/components/shortcut-kbd";
import {
  matchShortcut,
  resetShortcutOverrides,
  setShortcutOverride,
} from "@/features/keyboard/shortcut-registry";

const OVERRIDE_KEY = "snaptriage:shortcut-overrides";

describe("useShortcutLabel", () => {
  beforeEach(() => {
    resetShortcutOverrides();
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the registry key and follows an override", () => {
    const { result } = renderHook(() => useShortcutLabel("dismiss"));

    expect(result.current).toBe("D");

    act(() => setShortcutOverride("dismiss", "q"));
    expect(result.current).toBe("Q");

    act(() => resetShortcutOverrides());
    expect(result.current).toBe("D");
  });

  it("keeps the shift modifier on a rebound shifted shortcut", () => {
    const { result } = renderHook(() => useShortcutLabel("select-all"));

    expect(result.current).toBe("Shift+X");

    act(() => setShortcutOverride("select-all", "g"));
    expect(result.current).toBe("Shift+G");
  });

  it("renders the default key on the server even when an override is saved", () => {
    // The server snapshot is deliberately empty: markup that depends on
    // localStorage before hydration is a mismatch waiting for a returning user.
    setShortcutOverride("dismiss", "q");

    const html = renderToString(<ShortcutKbd id="dismiss" />);

    expect(html).toContain(">D<");
    expect(html).not.toContain(">Q<");
  });

  it("ignores a persisted override that is not a non-empty string", () => {
    window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ dismiss: 42, undo: null }));

    const { result } = renderHook(() => useShortcutLabel("dismiss"));

    expect(result.current).toBe("D");
  });

  it("falls back to the defaults when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    const { result } = renderHook(() => useShortcutLabel("dismiss"));
    expect(result.current).toBe("D");
    expect(matchShortcut(new KeyboardEvent("keydown", { key: "d" }))?.id).toBe("dismiss");
  });

  it("follows a change or clear made by another tab", () => {
    const { result } = renderHook(() => useShortcutLabel("dismiss"));
    expect(result.current).toBe("D");

    act(() => {
      window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ dismiss: "q" }));
      window.dispatchEvent(new StorageEvent("storage", { key: OVERRIDE_KEY }));
    });
    expect(result.current).toBe("Q");

    act(() => {
      window.localStorage.removeItem(OVERRIDE_KEY);
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    expect(result.current).toBe("D");
  });
});
