/**
 * @module tests/unit/features/triage/use-triage-mutation-hook
 *
 * The mutation's history contract: an undo is not recorded as a new undoable
 * action, and the queue advance rides on the mutation input so a retry keeps it.
 */
/* @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTriageMutation } from "@/features/triage/use-triage-mutation";
import { useUndoStore } from "@/features/triage/use-undo";
import { useKeyboardStore } from "@/features/keyboard/keyboard-store";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), warning: vi.fn() }),
}));

const INPUT = {
  issueId: "issue-1",
  payload: { dismissed: true },
  previousPayload: { dismissed: false },
  description: "Dismissed issue",
};

describe("useTriageMutation history", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as unknown as typeof fetch;
    useUndoStore.getState().clear();
    useKeyboardStore.getState().reset();
  });

  function wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  it("does not record an undo write as new history or request an advance", async () => {
    const { result } = renderHook(() => useTriageMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ...INPUT, undo: true, advanceAfterSuccess: true });
    });

    expect(useUndoStore.getState().liveStack).toHaveLength(0);
    expect(useUndoStore.getState().stack).toHaveLength(0);
    expect(useKeyboardStore.getState().advanceFromIssueId).toBeNull();
  });

  it("records a normal live write and requests the advance from the input", async () => {
    const { result } = renderHook(() => useTriageMutation(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({ ...INPUT, advanceAfterSuccess: true });
    });

    expect(useUndoStore.getState().liveStack).toHaveLength(1);
    expect(useUndoStore.getState().liveStack[0]).toMatchObject(INPUT);
    expect(useKeyboardStore.getState().advanceFromIssueId).toBe("issue-1");
  });
});
