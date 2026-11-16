/**
 * @module tests/unit/features/follow-up/follow-up-control
 *
 * The `w` key's path into the follow-up control.
 *
 * The shortcut records which issue it was pressed for and this component decides
 * what that means, so the interesting cases are all about state the user cannot
 * see: a list that has not loaded, and a follow-up that already exists. Both have
 * been the difference between opening a dialog and silently re-arming a watch,
 * which retracts a resurface the user has not read.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { FollowUpControl } from "@/features/follow-up/components/follow-up-control";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useKeyboardStore } from "@/features/keyboard/keyboard-store";
import type { FollowUpEntry, FollowUpList } from "@/features/follow-up/use-follow-ups";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

const ISSUE_ID = "issue-1";

/** A JSON response, since the hooks read one. */
function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** A waiting follow-up on the issue under test. */
function entry(overrides: Partial<FollowUpEntry> = {}): FollowUpEntry {
  return {
    issueId: ISSUE_ID,
    repoId: "repo-1",
    number: 42,
    title: "Checkout returns 500 on retry",
    url: "https://github.com/acme/console/issues/42",
    provider: "github",
    fullName: "acme/console",
    state: "waiting",
    reason: "reply",
    checkedAt: null,
    due: true,
    ...overrides,
  };
}

function list(entries: FollowUpEntry[]): FollowUpList {
  return { entries, checkedAt: null };
}

function renderControl() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <FollowUpControl issueId={ISSUE_ID} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  useKeyboardStore.setState({ followUpArmRequested: null });
  fetchMock = vi.fn(async () => json(list([entry()])));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FollowUpControl · the w key", () => {
  /**
   * @target FollowUpControl
   * @dependencies useFollowUps, useKeyboardStore
   * @scenario `w` is pressed for an issue whose follow-up already exists
   * @expectedOutput The details dialog opens and stays open. The request used to
   *                 be cleared in the same commit that derived the open state
   *                 from it, so the dialog appeared for one render and closed.
   */
  it("should open the details dialog for an existing follow-up", async () => {
    renderControl();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    useKeyboardStore.setState({ followUpArmRequested: ISSUE_ID });

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Follow-up")).toBeDefined();
    // The state row is rendered only when an entry was found, so its presence
    // proves the dialog opened on the existing follow-up rather than empty.
    expect(within(dialog).getByText("State")).toBeDefined();
  });

  /**
   * @target FollowUpControl
   * @dependencies useFollowUps
   * @scenario `w` is pressed while the follow-up list is still loading
   * @expectedOutput No arm request is sent. `entry` is null because the list has
   *                 not answered, not because the issue has no follow-up, and
   *                 arming on that reading clears the reason and baseline of a
   *                 resurface the user has not seen.
   */
  it("should not arm while the list is still loading", async () => {
    // Never settles, so the list stays pending for the assertion below.
    fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    renderControl();

    useKeyboardStore.setState({ followUpArmRequested: ISSUE_ID });

    // The only request allowed to have happened is the list read itself.
    const writes = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT"
    );
    expect(writes).toHaveLength(0);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  /**
   * @target FollowUpControl
   * @dependencies useFollowUps
   * @scenario The list failed to load and `w` is pressed
   * @expectedOutput The request is dropped rather than arming. Arming on top of
   *                 unknown state is the same mistake as arming while loading.
   */
  it("should drop the request when the list failed", async () => {
    fetchMock = vi.fn(async () => json({ error: "boom" }, 500));
    vi.stubGlobal("fetch", fetchMock);

    renderControl();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    useKeyboardStore.setState({ followUpArmRequested: ISSUE_ID });

    await waitFor(() => expect(useKeyboardStore.getState().followUpArmRequested).toBeNull());
    const writes = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === "PUT"
    );
    expect(writes).toHaveLength(0);
  });
});
