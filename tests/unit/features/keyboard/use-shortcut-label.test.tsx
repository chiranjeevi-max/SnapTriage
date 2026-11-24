/**
 * @module tests/unit/features/keyboard/use-shortcut-label
 *
 * Keycaps follow saved shortcut overrides and reset back to the registry key.
 */
/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { useShortcutLabel } from "@/features/keyboard/use-shortcut-label";
import { ShortcutKbd } from "@/features/keyboard/components/shortcut-kbd";
import { resetShortcutOverrides, setShortcutOverride } from "@/features/keyboard/shortcut-registry";

describe("useShortcutLabel", () => {
  beforeEach(() => {
    resetShortcutOverrides();
    window.localStorage.clear();
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
});
