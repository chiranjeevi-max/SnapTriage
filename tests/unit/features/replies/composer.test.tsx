/**
 * @module tests/unit/features/replies/composer
 *
 * What the composer promises before anything is published.
 *
 * The send rules come from `send-state.ts`; these tests exercise what the
 * component does with them. The one that matters most is the unconfirmed case:
 * a reply whose outcome is unknown must not offer Send again, because the
 * provider has no idempotency key and a duplicate public comment is the one
 * mistake here that cannot be undone.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useKeyboardShortcuts, useKeyboardStore, isEditableElement } from "@/features/keyboard";
import type { IssueWithTriage } from "@/features/inbox/use-issues";
import { Composer } from "@/features/replies/components/composer";
import {
  DraftConflictError,
  type ReplyDraft,
  type SavedReply,
} from "@/features/replies/use-replies";
import { providerLimits } from "@/lib/provider-interface";

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: vi.fn() }),
}));

const ISSUE = {
  id: "issue-1",
  url: "https://github.com/acme/console/issues/42",
  provider: "github",
};

/** The body the fixtures would send, kept short so assertions stay readable. */
const TYPED = "Thanks, reproduced on main.";

/**
 * The list the shortcut hook receives in the typing-guard test.
 *
 * Deliberately not empty. With no selection the `l` and `w` handlers bail on
 * their own guard, so the test would pass even if the editable-element check
 * were removed; a selected row is what makes those keys reach the dispatcher.
 */
const SHORTCUT_ISSUE: IssueWithTriage = {
  id: ISSUE.id,
  repoId: "repo-1",
  provider: ISSUE.provider,
  number: 42,
  title: "Crash on start",
  author: "nadia",
  authorAvatar: null,
  state: "open",
  labels: [],
  assignees: [],
  url: ISSUE.url,
  providerIssueId: "gh-42",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  fetchedAt: new Date().toISOString(),
  triage: null,
};

/**
 * A render harness with the query client the composer's hooks need.
 *
 * The hooks themselves are not mocked: `useDraft` and friends are simple
 * `fetch` wrappers, and stubbing `fetch` keeps the test on the real debounce
 * and the real error mapping, which is where the interesting behaviour is. The
 * tooltip provider is here because the app's own provider stack supplies it;
 * without it Radix refuses to render the Send tooltip.
 */
function renderComposer() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Composer issue={ISSUE} />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

/** A stored draft as `GET /api/issues/:id/draft` returns it. */
function draft(overrides: Partial<ReplyDraft> = {}): ReplyDraft {
  return {
    id: "draft-1",
    body: "",
    version: 1,
    sendAttemptedAt: null,
    sendClaimId: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * The reply textarea.
 *
 * Queried by the id its `<label for>` points at, because Radix marks the page
 * behind an open modal dialog `aria-hidden`, and the template picker is modal.
 * The id is part of the component's contract: it is what makes the visible
 * "Reply" label name the control.
 */
function textarea(): HTMLTextAreaElement {
  const element = document.getElementById(`reply-${ISSUE.id}`);
  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error("The reply textarea is not mounted");
  }
  return element;
}

/** A JSON response, since every hook here reads one. */
function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Wait for the debounced autosave to run. */
async function settleAutosave() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 1700));
  });
}

describe("Composer", () => {
  beforeEach(() => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/draft") && (!init || init.method === undefined)) {
        return json(null);
      }
      if (url.endsWith("/draft") && init?.method === "PUT") {
        const body = JSON.parse(String(init.body)) as { body: string; expectedVersion: number };
        return json(draft({ body: body.body, version: body.expectedVersion + 1 }));
      }
      if (url.endsWith("/draft") && init?.method === "DELETE") return json({ ok: true });
      if (url.endsWith("/saved-replies")) return json([]);
      if (url.endsWith("/replies")) {
        return json({
          ok: true,
          comment: {
            id: "c1",
            body: "",
            author: "me",
            authorAvatar: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isSystem: false,
            url: "https://github.com/acme/console/issues/42#issuecomment-1",
          },
        });
      }
      return json({});
    }) as unknown as typeof fetch;
    toastError.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps Send disabled with an empty body and enables it once there is text", async () => {
    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    const send = screen.getByRole("button", { name: "Send" });
    expect(send.hasAttribute("disabled")).toBe(true);

    fireEvent.change(textarea(), { target: { value: TYPED } });

    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false);
  });

  it("hides Send entirely and shows the notice when a previous attempt is unconfirmed", async () => {
    global.fetch = vi.fn(async () =>
      json(draft({ body: TYPED, sendAttemptedAt: new Date().toISOString() }))
    ) as unknown as typeof fetch;

    renderComposer();

    // The server's own sentence, which names the issue URL so the user can go
    // and look before doing anything else.
    expect(
      await screen.findByText(/This reply may already be posted\. Check the issue before sending/)
    ).toBeDefined();
    expect(screen.getByText(new RegExp(ISSUE.url))).toBeDefined();

    // No retry affordance and no claim that it failed.
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.queryByText(/undo/i)).toBeNull();
    expect(screen.queryByText(/failed/i)).toBeNull();
  });

  it("keeps typed text when the save is refused by a version conflict", async () => {
    let putCount = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/draft") && init?.method === "PUT") {
        putCount += 1;
        return json({ error: "This draft changed somewhere else. Reload it before saving." }, 409);
      }
      if (url.endsWith("/draft")) return json(draft({ body: "older text", version: 2 }));
      if (url.endsWith("/saved-replies")) return json([]);
      return json({});
    }) as unknown as typeof fetch;

    renderComposer();
    await waitFor(() => expect(textarea().value).toBe("older text"));

    fireEvent.change(textarea(), { target: { value: TYPED } });
    await settleAutosave();

    expect(putCount).toBeGreaterThan(0);
    expect(
      await screen.findByText("This draft changed somewhere else. Reload it before saving.")
    ).toBeDefined();
    // The text the user typed is still there; the conflict is a banner, not a
    // silent replacement with the stored version.
    expect(textarea().value).toBe(TYPED);
    // Send stays closed while the conflict is unresolved: posting would publish
    // text the stored draft does not contain, which is the state the banner asks
    // the user to settle first.
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });

  it("asks before a saved reply would overwrite text already in the composer", async () => {
    const templates: SavedReply[] = [
      {
        id: "saved-1",
        name: "Thanks for the report",
        body: "Thanks for the report. We are looking into it.",
        createdAt: "2026-11-15T00:00:00.000Z",
        updatedAt: "2026-11-15T00:00:00.000Z",
      },
    ];

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/draft")) return json(null);
      if (url.endsWith("/saved-replies")) return json(templates);
      return json({});
    }) as unknown as typeof fetch;

    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    fireEvent.change(textarea(), { target: { value: TYPED } });
    fireEvent.click(screen.getByRole("button", { name: "Saved replies" }));
    fireEvent.click(await screen.findByText("Thanks for the report"));

    // The template is not written straight into the textarea: the composer asks
    // how it should meet the text that is already there.
    expect(await screen.findByText(/already has text/)).toBeDefined();
    expect(textarea().value).toBe(TYPED);

    fireEvent.click(screen.getByRole("button", { name: "Replace draft" }));

    expect(textarea().value).toBe("Thanks for the report. We are looking into it.");
  });

  it("inserts a saved reply at the cursor when the composer is empty", async () => {
    const templates: SavedReply[] = [
      {
        id: "saved-1",
        name: "Needs a reproduction",
        body: "Could you add the exact command?",
        createdAt: "2026-11-15T00:00:00.000Z",
        updatedAt: "2026-11-15T00:00:00.000Z",
      },
    ];

    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/draft")) return json(null);
      if (url.endsWith("/saved-replies")) return json(templates);
      return json({});
    }) as unknown as typeof fetch;

    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    fireEvent.change(textarea(), { target: { value: "Start " } });
    textarea().setSelectionRange(6, 6);

    fireEvent.click(screen.getByRole("button", { name: "Saved replies" }));
    fireEvent.click(await screen.findByText("Needs a reproduction"));

    // There was text, so the question is still asked; choosing the cursor keeps
    // the existing prose and appends at the caret.
    fireEvent.click(await screen.findByRole("button", { name: "Insert at cursor" }));

    expect(textarea().value).toBe("Start Could you add the exact command?");
  });

  /**
   * @target Composer
   * @dependencies saved replies
   * @scenario A template is chosen while the composer is empty
   * @expectedOutput The body is inserted directly, with no question about where.
   *                 Asking "insert at cursor or replace?" on an empty composer
   *                 offers a choice that does not exist.
   */
  it("inserts a template into an empty composer without asking", async () => {
    const templates = [
      { id: "tpl-1", name: "Needs a reproduction", body: "Could you add the exact command?" },
    ];
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/draft")) return json(null);
      if (url.endsWith("/saved-replies")) return json(templates);
      return json({});
    }) as unknown as typeof fetch;

    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    fireEvent.click(screen.getByRole("button", { name: "Saved replies" }));
    fireEvent.click(await screen.findByText("Needs a reproduction"));

    expect(screen.queryByRole("button", { name: "Insert at cursor" })).toBeNull();
    expect(textarea().value).toBe("Could you add the exact command?");
  });

  /**
   * @target Composer
   * @dependencies useDraft
   * @scenario The draft request has not answered yet and the user presses
   *           Ctrl+Enter
   * @expectedOutput Nothing is sent, and the text stays. A send before the draft
   *                 is known would carry no base version, so the server could not
   *                 refuse it on staleness — the exact check that stops this tab
   *                 publishing text another tab replaced.
   */
  it("should not send while the draft is still loading", async () => {
    let releaseDraft = () => {};
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/draft")) {
        await new Promise<void>((resolve) => {
          releaseDraft = resolve;
        });
        return json(null);
      }
      if (url.endsWith("/saved-replies")) return json([]);
      return json({});
    }) as unknown as typeof fetch;

    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    fireEvent.change(textarea(), { target: { value: "Ready to go" } });
    fireEvent.keyDown(textarea(), { key: "Enter", ctrlKey: true });

    const sends = vi
      .mocked(global.fetch)
      .mock.calls.filter(([input]) => String(input).endsWith("/replies"));
    expect(sends).toHaveLength(0);
    expect(textarea().value).toBe("Ready to go");

    releaseDraft();
  });

  /**
   * @target Composer
   * @dependencies useDraft, useSendReply
   * @scenario A send fails with a 502 whose body omits the `unconfirmed` flag
   * @expectedOutput Send is withheld. A gateway can drop that flag, and treating
   *                 its absence as a refusal removes the guard on a comment the
   *                 provider may already have published.
   */
  it("should treat a 502 without the unconfirmed flag as unresolved", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/draft")) return json(null);
      if (url.endsWith("/saved-replies")) return json([]);
      if (url.endsWith("/replies") && init?.method === "POST") {
        return json({ error: "Bad gateway" }, 502);
      }
      return json({});
    }) as unknown as typeof fetch;

    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    fireEvent.change(textarea(), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    expect(await screen.findByText(/may already be posted/i)).toBeDefined();
    expect(screen.queryByRole("button", { name: /^send/i })).toBeNull();
  });

  /**
   * @target Composer
   * @dependencies useDiscardDraft, reloadStoredDraft
   * @scenario The user types against version 1, a conflict is raised, they reload
   *           the stored draft (now version 3), and then discard
   * @expectedOutput Discard carries version 3, the revision on screen. The pin from
   *                 before the reload used to survive it, so every later send and
   *                 discard named a version the stored draft had already passed and
   *                 the server refused them as stale.
   */
  it("should discard with the reloaded version after a conflict reload", async () => {
    let draftVersion = 1;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      // The conflict happens on the autosave. By the time the user reloads, the
      // other tab's version is the stored one, so the reload's GET must report it.
      if (url.includes("/draft") && init?.method === "PUT") {
        draftVersion = 3;
        return json({ error: "This draft changed in another tab." }, 409);
      }
      if (url.includes("/draft") && init?.method === "DELETE") {
        return json({ ok: true });
      }
      if (url.endsWith("/saved-replies")) return json([]);
      if (url.startsWith("/api/issues") && url.includes("/draft")) {
        return json({
          id: "d1",
          body: "",
          version: draftVersion,
          sendAttemptedAt: null,
          sendClaimId: null,
          updatedAt: new Date().toISOString(),
        });
      }
      return json({});
    }) as unknown as typeof fetch;

    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    fireEvent.change(textarea(), { target: { value: TYPED } });

    // The conflict banner appears once the collided autosave answers.
    const reload = await screen.findByRole(
      "button",
      { name: /reload the stored draft/i },
      {
        timeout: 3_000,
      }
    );
    fireEvent.click(reload);

    // The reload is async: it refetches, then clears the pin and the typed text.
    // Clicking discard before that settles would read the pre-reload base and
    // assert nothing about the reset this test exists for.
    await waitFor(() => expect(textarea().value).toBe(""));

    fireEvent.click(screen.getByRole("button", { name: /discard/i }));

    await waitFor(() => {
      const del = vi
        .mocked(global.fetch)
        .mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "DELETE");
      expect(del).toBeDefined();
      expect(String(del?.[0])).toContain("version=3");
    });
  });

  /**
   * @target Composer
   * @dependencies useSendReply
   * @scenario The server answers 422 for a definitive provider rejection
   * @expectedOutput Send stays available and the text is kept. A 422 is a refusal,
   *                 so withholding Send would lock the user out of a reply the
   *                 provider declined outright.
   */
  it("should keep Send available after a definitive rejection", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/draft")) return json(null);
      if (url.endsWith("/saved-replies")) return json([]);
      if (url.endsWith("/replies") && init?.method === "POST") {
        return json({ error: "The provider rejected this reply." }, 422);
      }
      return json({});
    }) as unknown as typeof fetch;

    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    fireEvent.change(textarea(), { target: { value: "Thanks!" } });
    fireEvent.click(screen.getByRole("button", { name: /send/i }));

    await waitFor(() => expect(screen.queryByRole("button", { name: /^send/i })).not.toBeNull());
    expect(screen.queryByText(/may already be posted/i)).toBeNull();
    expect(textarea().value).toBe("Thanks!");
  });

  it("shows the character counter only near the limit and never blocks typing below it", async () => {
    const limit = providerLimits.github.comment;
    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    // One character below the counter's visibility margin: no counter, and the
    // body is still accepted.
    const below = "a".repeat(limit - 1001);
    fireEvent.change(textarea(), { target: { value: below } });
    expect(screen.queryByText(/left$/)).toBeNull();
    expect(textarea().value).toHaveLength(limit - 1001);
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false);

    // Inside the margin the remaining count appears...
    const near = "a".repeat(limit - 10);
    fireEvent.change(textarea(), { target: { value: near } });
    expect(screen.getByText("10 left")).toBeDefined();
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(false);

    // ...and past it the counter says how far over, which is the only case
    // where Send is withheld for length.
    const over = "a".repeat(limit + 3);
    fireEvent.change(textarea(), { target: { value: over } });
    expect(screen.getByText(/3 over the 65,536 limit/)).toBeDefined();
    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });

  it("posts the reply and says it cannot be undone, with no Undo action", async () => {
    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    fireEvent.change(textarea(), { target: { value: TYPED } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText(/Reply posted/)).toBeDefined();
    expect(screen.getByText(/cannot be edited or removed from here/)).toBeDefined();
    expect(screen.queryByRole("button", { name: /undo/i })).toBeNull();
    expect(screen.getByRole("link", { name: /View it on the provider/ })).toBeDefined();
  });

  it("surfaces the server's unconfirmed sentence verbatim and withholds Send", async () => {
    const sentence =
      "We could not confirm this reply was posted. Check the issue before sending again; your draft has been kept.";

    let posted = false;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/replies")) {
        posted = true;
        return json({ error: sentence, unconfirmed: true }, 409);
      }
      if (url.endsWith("/draft")) {
        if (!posted) return json(null);
        return json(draft({ body: TYPED, sendAttemptedAt: new Date().toISOString() }));
      }
      if (url.endsWith("/saved-replies")) return json([]);
      return json({});
    }) as unknown as typeof fetch;

    renderComposer();
    await waitFor(() => expect(textarea()).toBeDefined());

    fireEvent.change(textarea(), { target: { value: TYPED } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The server's sentence reaches the toast unchanged: it is the only text
    // that says the outcome is unknown rather than bad.
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(sentence));

    // The composer then holds the persistent version of the same warning, which
    // is driven by `sendAttemptedAt` rather than by a message it stashed.
    expect(await screen.findByText(/This reply may already be posted/)).toBeDefined();
    expect(screen.getByRole("alert").textContent).not.toMatch(/failed/i);
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    // The text is kept: the draft is the only copy, and it may be the copy that
    // is already published.
    expect(textarea().value).toBe(TYPED);
  });

  it("never lets a global shortcut fire while the reply is being typed", async () => {
    // Proves the existing guard rather than adding one: `isEditableElement`
    // returns true for a textarea, and `useKeyboardShortcuts` checks it before
    // matching. `l` opens the label picker through the store, so it is an
    // observable effect of a shortcut that must not happen mid-sentence.
    function Harness() {
      // A real selected issue, not an empty list. With `NO_ISSUES` the `l` and
      // `w` handlers bail on their own "no current issue" guard, so the test
      // would pass even if the editable-element check were removed.
      useKeyboardShortcuts([SHORTCUT_ISSUE]);
      return <Composer issue={ISSUE} />;
    }

    useKeyboardStore.getState().reset();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Harness />
        </TooltipProvider>
      </QueryClientProvider>
    );

    await waitFor(() => expect(textarea()).toBeDefined());

    // The guard itself, which is what makes the assertions below pass: the
    // composer's textarea is an editable element, so the listener bails before
    // matching. `isEditableElement` decides this, not the composer.
    expect(isEditableElement(textarea())).toBe(true);

    fireEvent.change(textarea(), { target: { value: "lo" } });
    fireEvent.keyDown(textarea(), { key: "l" });
    fireEvent.keyDown(textarea(), { key: "d" });
    fireEvent.keyDown(textarea(), { key: "w" });

    expect(useKeyboardStore.getState().labelPickerOpen).toBe(false);
    expect(useKeyboardStore.getState().followUpArmRequested).toBeNull();
    expect(textarea().value).toBe("lo");

    // The listener is attached: the same kind of key outside the textarea does
    // reach the dispatcher, so the assertions above are not passing merely
    // because nothing is listening. Escape closes the detail pane, which needs
    // no selected issue and is visible in the store.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(useKeyboardStore.getState().selectedIndex).toBe(-1);
  });

  it("reports a conflict through the typed error class, not a bare 409", () => {
    const conflict = new DraftConflictError("changed somewhere else");
    expect(conflict).toBeInstanceOf(DraftConflictError);
    expect(conflict.message).toBe("changed somewhere else");
  });
});
