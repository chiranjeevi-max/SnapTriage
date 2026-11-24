/**
 * @module tests/unit/features/keyboard/use-keyboard-actions
 *
 * Undo when the queue is empty, and the Follow-ups boundary.
 *
 * The live and staged stacks are independent of the visible list. `z` may
 * reverse the last action after the final row leaves, but it must stay muted on
 * Follow-ups where the row it would change is not on screen.
 */
/* @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "@/features/keyboard";
import type { KeyboardActionOptions } from "@/features/keyboard/use-keyboard-actions";
import { useKeyboardStore } from "@/features/keyboard/keyboard-store";
import { useUndoStore } from "@/features/triage/use-undo";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

const { mutate } = vi.hoisted(() => ({ mutate: vi.fn() }));

vi.mock("@/features/triage/use-triage-mutation", () => ({
  useTriageMutation: () => ({ mutate }),
}));
vi.mock("@/features/triage/use-batch", () => ({
  useBatchPush: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/features/inbox/use-issues", () => ({
  useSync: () => ({ mutate: vi.fn() }),
}));

const NO_ISSUES: IssueWithTriage[] = [];

const ACTION = {
  issueId: "issue-1",
  payload: { dismissed: true },
  previousPayload: { dismissed: false },
  description: "Dismissed issue",
};

function Harness({ options }: { options?: KeyboardActionOptions }) {
  useKeyboardShortcuts(NO_ISSUES, options);
  return null;
}

describe("undo with an empty queue", () => {
  beforeEach(() => {
    useKeyboardStore.getState().reset();
    useUndoStore.getState().clear();
    mutate.mockReset();
    window.localStorage.clear();
  });

  it("reverses a live action when the queue is empty and undo is allowed", () => {
    useUndoStore.getState().pushLive(ACTION);
    render(<Harness options={{ undoAllowed: true }} />);

    fireEvent.keyDown(window, { key: "z" });

    expect(mutate).toHaveBeenCalledWith({
      issueId: "issue-1",
      payload: ACTION.previousPayload,
      previousPayload: ACTION.payload,
      description: "Undid last action",
      undo: true,
    });
  });

  it("reverses a staged action when the queue is empty and undo is allowed", () => {
    useUndoStore.getState().push(ACTION);
    render(<Harness options={{ undoAllowed: true }} />);

    fireEvent.keyDown(window, { key: "z" });

    expect(mutate).toHaveBeenCalledWith({
      issueId: "issue-1",
      payload: ACTION.previousPayload,
      previousPayload: ACTION.payload,
      description: "Undid staged change",
      batch: true,
      undo: true,
    });
  });

  it("stays muted on Follow-ups, where the queue is not on screen", () => {
    useUndoStore.getState().pushLive(ACTION);
    render(<Harness options={{ undoAllowed: false }} />);

    fireEvent.keyDown(window, { key: "z" });

    expect(mutate).not.toHaveBeenCalled();
    expect(useUndoStore.getState().liveStack).toHaveLength(1);
  });
});
