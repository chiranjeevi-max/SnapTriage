import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUndoStore, showUndoToast } from "@/features/triage/use-undo";
import { toast } from "sonner";
import type { TriageAction } from "@/features/triage/types";

vi.mock("sonner", () => ({
  toast: vi.fn(),
}));

describe("useUndoStore", () => {
  const mockAction1: TriageAction = {
    issueId: "1",
    payload: { priority: 1 },
    previousPayload: { priority: null },
    description: "Set priority to 1",
  };

  const mockAction2: TriageAction = {
    issueId: "2",
    payload: { snoozedUntil: "2026-01-01T00:00:00Z" },
    previousPayload: { snoozedUntil: null },
    description: "Snoozed issue",
  };

  beforeEach(() => {
    useUndoStore.getState().clear();
  });

  it("should initialize with an empty stack", () => {
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it("should push an action to the stack", () => {
    useUndoStore.getState().push(mockAction1);
    expect(useUndoStore.getState().stack).toMatchObject([mockAction1]);

    useUndoStore.getState().push(mockAction2);
    expect(useUndoStore.getState().stack).toMatchObject([mockAction1, mockAction2]);
  });

  it("should pop an action from the stack and return it", () => {
    useUndoStore.getState().push(mockAction1);
    useUndoStore.getState().push(mockAction2);

    const popped = useUndoStore.getState().pop();
    expect(popped).toMatchObject(mockAction2);
    expect(useUndoStore.getState().stack).toMatchObject([mockAction1]);

    const popped2 = useUndoStore.getState().pop();
    expect(popped2).toMatchObject(mockAction1);
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it("should return undefined when popping an empty stack", () => {
    const popped = useUndoStore.getState().pop();
    expect(popped).toBeUndefined();
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it("should clear all actions from the stack", () => {
    useUndoStore.getState().push(mockAction1);
    useUndoStore.getState().push(mockAction2);

    useUndoStore.getState().clear();
    expect(useUndoStore.getState().stack).toEqual([]);
  });

  it("records live actions with an id and pops the most recent", () => {
    const first = useUndoStore.getState().pushLive(mockAction1);
    const second = useUndoStore.getState().pushLive(mockAction2);

    expect(useUndoStore.getState().liveStack).toHaveLength(2);
    expect(useUndoStore.getState().popLive()).toMatchObject({ ...mockAction2, id: second });
    expect(useUndoStore.getState().popLive()).toMatchObject({ ...mockAction1, id: first });
    expect(useUndoStore.getState().popLive()).toBeUndefined();
  });

  it("removes one live action by id so the toast and z cannot undo twice", () => {
    const first = useUndoStore.getState().pushLive(mockAction1);
    const second = useUndoStore.getState().pushLive(mockAction2);

    expect(useUndoStore.getState().removeLive(first)).toMatchObject({ ...mockAction1, id: first });
    expect(useUndoStore.getState().removeLive(first)).toBeUndefined();
    expect(useUndoStore.getState().liveStack).toHaveLength(1);
    expect(useUndoStore.getState().popLive()).toMatchObject({ ...mockAction2, id: second });
  });

  it("orders staged and live entries by the same sequence", () => {
    const stagedOrder = useUndoStore.getState().push(mockAction1);
    useUndoStore.getState().pushLive(mockAction2);

    expect(stagedOrder).toBeLessThan(useUndoStore.getState().liveStack[0].sequence);
  });

  it("clears both stacks together", () => {
    useUndoStore.getState().push(mockAction1);
    useUndoStore.getState().pushLive(mockAction2);

    useUndoStore.getState().clear();
    expect(useUndoStore.getState().stack).toEqual([]);
    expect(useUndoStore.getState().liveStack).toEqual([]);
  });
});

describe("showUndoToast", () => {
  it("should call toast with the correct arguments", () => {
    const description = "Test action";
    const onUndo = vi.fn();

    showUndoToast(description, onUndo);

    expect(toast).toHaveBeenCalledWith(description, {
      duration: 5000,
      action: {
        label: "Undo",
        onClick: onUndo,
      },
    });
  });
});
