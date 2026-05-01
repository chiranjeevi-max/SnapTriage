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
    expect(useUndoStore.getState().stack).toEqual([mockAction1]);

    useUndoStore.getState().push(mockAction2);
    expect(useUndoStore.getState().stack).toEqual([mockAction1, mockAction2]);
  });

  it("should pop an action from the stack and return it", () => {
    useUndoStore.getState().push(mockAction1);
    useUndoStore.getState().push(mockAction2);

    const popped = useUndoStore.getState().pop();
    expect(popped).toEqual(mockAction2);
    expect(useUndoStore.getState().stack).toEqual([mockAction1]);

    const popped2 = useUndoStore.getState().pop();
    expect(popped2).toEqual(mockAction1);
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
