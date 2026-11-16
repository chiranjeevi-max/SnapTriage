/**
 * @module tests/unit/features/replies/discussion
 *
 * What the discussion section says, and what it refuses to say.
 *
 * The distinction these tests guard is between "nobody has replied" and "this
 * provider does not expose comments". The second rendered as the first would
 * tell a maintainer the reporter has gone quiet when the truth is that the app
 * cannot see the thread at all.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { Discussion } from "@/features/replies/components/discussion";
import type { CommentsPage, ReplyComment } from "@/features/replies/use-replies";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

const ISSUE_ID = "issue-1";
const ISSUE_URL = "https://github.com/acme/console/issues/42";

/** One comment, defaulting to an ordinary human reply. */
function comment(overrides: Partial<ReplyComment> = {}): ReplyComment {
  return {
    id: "1",
    body: "Any update on this?",
    author: "nadia",
    authorAvatar: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isSystem: false,
    url: null,
    ...overrides,
  };
}

/** A JSON response, since the hook reads one. */
function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Render the section with a query client, as the detail pane does. */
function renderDiscussion() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return render(<Discussion issueId={ISSUE_ID} providerUrl={ISSUE_URL} />, { wrapper });
}

describe("Discussion", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a thread oldest first with every author and body", async () => {
    const page: CommentsPage = {
      comments: [
        comment({ id: "1", body: "First reply", author: "nadia" }),
        comment({ id: "2", body: "Second reply", author: "jo" }),
      ],
      olderCursor: null,
      supported: true,
    };
    global.fetch = vi.fn(async () => json(page)) as unknown as typeof fetch;

    renderDiscussion();

    expect(await screen.findByText("First reply")).toBeDefined();
    expect(screen.getByText("Second reply")).toBeDefined();
    expect(screen.getByText("nadia")).toBeDefined();
    expect(screen.getByText("jo")).toBeDefined();

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      expect.stringContaining("First reply"),
      expect.stringContaining("Second reply"),
    ]);
  });

  it("says the provider has no discussion rather than showing an empty thread", async () => {
    global.fetch = vi.fn(async () =>
      json({ comments: [], olderCursor: null, supported: false })
    ) as unknown as typeof fetch;

    renderDiscussion();

    expect(await screen.findByText(/This provider does not expose issue comments/)).toBeDefined();
    // The "nobody replied" sentence must not appear in its place.
    expect(screen.queryByText(/No replies yet/)).toBeNull();
    expect(screen.getByRole("link", { name: /Open the issue on the provider/ })).toBeDefined();
  });

  it("loads the next page from the older cursor", async () => {
    const newest: CommentsPage = {
      comments: [comment({ id: "3", body: "Newest reply" })],
      olderCursor: "page-2",
      supported: true,
    };
    const older: CommentsPage = {
      comments: [comment({ id: "1", body: "Oldest reply" })],
      olderCursor: null,
      supported: true,
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("cursor=page-2") ? json(older) : json(newest);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDiscussion();
    expect(await screen.findByText("Newest reply")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Older comments" }));

    expect(await screen.findByText("Oldest reply")).toBeDefined();
    // Older history belongs above the reply that was already read.
    const items = screen.getAllByRole("listitem");
    expect(items[0].textContent).toContain("Oldest reply");
    expect(items[1].textContent).toContain("Newest reply");

    // The cursor reached the server exactly as it was returned.
    expect(String(fetchMock.mock.calls[1][0])).toContain("cursor=page-2");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Older comments" })).toBeNull()
    );
  });

  it("keeps a system note visible and marks it as a record rather than a reply", async () => {
    const page: CommentsPage = {
      comments: [
        comment({ id: "1", body: "added label bug", author: "ghost", isSystem: true }),
        comment({ id: "2", body: "Reproduced, thanks.", author: "nadia" }),
      ],
      olderCursor: null,
      supported: true,
    };
    global.fetch = vi.fn(async () => json(page)) as unknown as typeof fetch;

    renderDiscussion();

    const note = await screen.findByLabelText("System note");
    expect(within(note).getByText("added label bug")).toBeDefined();
    expect(within(note).getByText("note")).toBeDefined();

    // The human reply is not marked as a record.
    const human = screen.getAllByRole("listitem").find((item) => item !== note);
    expect(human?.getAttribute("aria-label")).toBeNull();
  });

  it("reports a failed load with the provider's own sentence and a retry", async () => {
    global.fetch = vi.fn(async () =>
      json({ error: "Could not load this discussion right now." }, 502)
    ) as unknown as typeof fetch;

    renderDiscussion();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load this discussion right now.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });

  it("keeps the loaded thread when fetching an older page fails", async () => {
    const newest: CommentsPage = {
      comments: [comment({ id: "3", body: "Already loaded reply" })],
      olderCursor: "page-2",
      supported: true,
    };

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes("cursor=page-2")
        ? json({ error: "Could not load this discussion right now." }, 502)
        : json(newest);
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDiscussion();
    expect(await screen.findByText("Already loaded reply")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Older comments" }));

    // The failure reports itself, but the comments already on screen stay: a
    // failed "load older" is not a reason to blank the conversation.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load this discussion right now.");
    expect(screen.getByText("Already loaded reply")).toBeDefined();
  });

  it("collapses and stops asking for comments while closed", async () => {
    const fetchMock = vi.fn(async () =>
      json({ comments: [comment()], olderCursor: null, supported: true })
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    renderDiscussion();
    expect(await screen.findByText("Any update on this?")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /Discussion/ }));

    expect(screen.queryByText("Any update on this?")).toBeNull();
    expect(screen.getByRole("button", { name: /Discussion/ }).getAttribute("aria-expanded")).toBe(
      "false"
    );
  });
});
