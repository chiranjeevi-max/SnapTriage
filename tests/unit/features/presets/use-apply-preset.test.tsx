/**
 * @module tests/unit/features/presets/use-apply-preset
 *
 * The apply mutation's contract, which is mostly about what it does *not* do:
 * a no-op reports itself and leaves no undo entry, a batch apply stages instead
 * of showing a live undo, and a rejection repeats the server's sentence rather
 * than claiming a rollback it never performed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { useApplyPreset } from "@/features/presets/use-apply-preset";
import { resolvePreset } from "@/features/presets/types";
import type { ApplyPresetInput } from "@/features/presets/use-apply-preset";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

const { toastMock, toastError, toastSuccess, showUndoToast, pushUndo } = vi.hoisted(() => ({
  toastMock: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  showUndoToast: vi.fn(),
  pushUndo: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(toastMock, { error: toastError, success: toastSuccess }),
}));

vi.mock("@/features/triage/use-undo", () => ({
  showUndoToast,
  useUndoStore: (selector: (state: { push: typeof pushUndo }) => unknown) =>
    selector({ push: pushUndo }),
}));

/** The issue the preset is applied to: it already has `bug` and P2. */
const ISSUE: IssueWithTriage = {
  id: "issue-1",
  repoId: "repo-1",
  provider: "github",
  number: 42,
  title: "Checkout returns 500 on retry",
  author: "jo",
  authorAvatar: null,
  state: "open",
  labels: ["bug"],
  assignees: [],
  url: "https://github.com/acme/console/issues/42",
  providerIssueId: "42",
  createdAt: "2026-11-14T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
  fetchedAt: "2026-11-15T00:00:00.000Z",
  triage: { id: "triage-1", priority: 2, snoozedUntil: null, dismissed: false },
};

/** The resolution the user approved before the request went out. */
const PREVIEW = resolvePreset({ priority: 1, labels: { add: ["bug", "confirmed"] } }, ISSUE);

describe("useApplyPreset", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    queryClient.setQueryData<IssueWithTriage[]>(["issues", "all", "open"], [ISSUE]);
    queryClient.setQueryData(["issue", "issue-1"], ISSUE);
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  function input(overrides: Partial<ApplyPresetInput> = {}): ApplyPresetInput {
    return {
      issueId: "issue-1",
      presetId: "preset-1",
      presetName: "Confirmed bug",
      preview: PREVIEW,
      ...overrides,
    };
  }

  it("posts the preset id and the requested mode", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        mode: "live",
        noChange: false,
        applied: PREVIEW.payload,
        changes: PREVIEW.changes,
      }),
    } as Response);

    const { result } = renderHook(() => useApplyPreset(), { wrapper });
    result.current.mutate(input());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(global.fetch).toHaveBeenCalledWith("/api/issues/issue-1/apply-preset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ presetId: "preset-1", batch: undefined }),
    });
  });

  it("reports a no-op without offering an undo", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true, mode: "live", noChange: true, applied: {}, changes: [] }),
    } as Response);

    const { result } = renderHook(() => useApplyPreset(), { wrapper });
    result.current.mutate(input());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(toastMock).toHaveBeenCalledWith("Already applied", {
      description: "This issue already matches the preset.",
    });
    expect(showUndoToast).not.toHaveBeenCalled();
    expect(pushUndo).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("registers a live undo whose inverse only reverses what the preset changed", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        mode: "live",
        noChange: false,
        applied: PREVIEW.payload,
        changes: PREVIEW.changes,
      }),
    } as Response);

    const { result } = renderHook(() => useApplyPreset(), { wrapper });
    result.current.mutate(input());

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(showUndoToast).toHaveBeenCalledTimes(1);
    const [description, onUndo] = showUndoToast.mock.calls[0] as [string, () => void];
    expect(description).toBe('Applied "Confirmed bug"');
    expect(pushUndo).not.toHaveBeenCalled();

    // Firing the undo re-PATCHes the inverse: priority back to P2, `confirmed`
    // removed, and `bug` — which the issue already had — left alone.
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ok: true }),
    } as Response);
    onUndo();

    await waitFor(() =>
      expect(global.fetch).toHaveBeenCalledWith("/api/issues/issue-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priority: 2,
          labels: { add: [], remove: ["confirmed"] },
        }),
      })
    );
  });

  it("stages instead of showing a live undo when the server answered batch", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        ok: true,
        mode: "batch",
        noChange: false,
        applied: PREVIEW.payload,
        changes: PREVIEW.changes,
      }),
    } as Response);

    const { result } = renderHook(() => useApplyPreset(), { wrapper });
    result.current.mutate(input({ batch: true }));

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(showUndoToast).not.toHaveBeenCalled();
    expect(pushUndo).toHaveBeenCalledWith({
      issueId: "issue-1",
      payload: PREVIEW.payload,
      previousPayload: { priority: 2, labels: { add: [], remove: ["confirmed"] } },
      description: 'Applied "Confirmed bug"',
    });
  });

  it("surfaces the server's rejection verbatim and restores the cache", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Preset and issue belong to different repositories" }),
    } as Response);

    const { result } = renderHook(() => useApplyPreset(), { wrapper });
    result.current.mutate(input());

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(toastError).toHaveBeenCalledWith("Preset and issue belong to different repositories");
    expect(showUndoToast).not.toHaveBeenCalled();
    expect(pushUndo).not.toHaveBeenCalled();
    expect(queryClient.getQueryData<IssueWithTriage[]>(["issues", "all", "open"])).toEqual([ISSUE]);
  });
});
