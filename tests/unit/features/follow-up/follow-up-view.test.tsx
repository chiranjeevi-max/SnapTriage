/**
 * @module tests/unit/features/follow-up/follow-up-view
 *
 * What the follow-up queue says, and what it refuses to imply.
 *
 * Two things are load-bearing here. The reason must come from
 * `describeFollowUpReason` so the queue and the detector cannot disagree about
 * what "Replied" means. And freshness must be stated, because nothing polls:
 * the queue is only as current as the last time the user opened it, and a list
 * that looks live when it is three days old is the one lie this feature cannot
 * afford.
 */
/* @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import { FollowUpView } from "@/features/follow-up/components/follow-up-view";
import { WORST_CASE_FOLLOW_UPS, followUpsForMode } from "@/features/dev-tools/fixtures";
import type { FollowUpEntry, FollowUpList } from "@/features/follow-up/use-follow-ups";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

/** A JSON response, since the hooks read one. */
function json(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** One queue entry, with the fields the row does not render defaulted. */
function entry(overrides: Partial<FollowUpEntry> & { issueId: string }): FollowUpEntry {
  return {
    repoId: "repo-1",
    number: 42,
    title: "Checkout returns 500 on retry",
    url: "https://github.com/acme/console/issues/42",
    provider: "github",
    fullName: "acme/console",
    state: "waiting",
    reason: null,
    checkedAt: new Date().toISOString(),
    due: false,
    ...overrides,
  };
}

/** A fetch stub: one list response, and one check response per POST. */
function stubFetch(list: FollowUpList) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "POST") return json({ checked: 1, surfaced: 0, skipped: 0 });
    return json(list);
  });
  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

/** Render the view inside the query client the inbox provides. */
function renderView(list: FollowUpList) {
  const fetchMock = stubFetch(list);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onOpenIssue = vi.fn();

  const view = render(
    <QueryClientProvider client={queryClient}>
      <FollowUpView onOpenIssue={onOpenIssue} />
    </QueryClientProvider>
  );

  return { fetchMock, onOpenIssue, view };
}

describe("FollowUpView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the reason through describeFollowUpReason for every entry", async () => {
    renderView({
      entries: [
        entry({ issueId: "a", reason: "reply", due: true, title: "Answered issue" }),
        entry({ issueId: "b", reason: "reopened", due: true, title: "Reopened issue" }),
        entry({ issueId: "c", reason: null, due: false, title: "Quiet issue" }),
      ],
      checkedAt: new Date().toISOString(),
    });

    const answered = (await screen.findByText("Answered issue")).closest("li");
    expect(answered).not.toBeNull();
    expect(within(answered!).getByText("Replied")).toBeDefined();

    const reopened = screen.getByText("Reopened issue").closest("li");
    expect(within(reopened!).getByText("Reopened")).toBeDefined();

    // A waiting issue with no recognised activity is not a reason at all.
    const quiet = screen.getByText("Quiet issue").closest("li");
    expect(within(quiet!).getByText("Waiting")).toBeDefined();
  });

  it("states freshness, and says so plainly when nothing has ever been checked", async () => {
    renderView({
      entries: [entry({ issueId: "a", checkedAt: new Date(Date.now() - 120_000).toISOString() })],
      checkedAt: new Date(Date.now() - 120_000).toISOString(),
    });

    expect(await screen.findByText(/Last checked 2m ago/)).toBeDefined();
    // Nothing in the copy may promise a background check.
    expect(screen.getByText(/never in the background/)).toBeDefined();
  });

  it("says an unchecked issue has not been checked instead of rendering an empty age", async () => {
    const list = followUpsForMode("worst");
    // The fixture's first row is the null-`checkedAt` case.
    expect(list.entries[0].checkedAt).toBeNull();

    renderView({
      entries: [list.entries[0]],
      checkedAt: null,
    });

    expect(await screen.findByText("never checked")).toBeDefined();
    expect(screen.getByText(/Not checked yet/)).toBeDefined();
  });

  it("says how stale a three-day-old check is", async () => {
    const stale = WORST_CASE_FOLLOW_UPS.find((item) => item.checkedAt !== null);
    expect(stale).toBeDefined();
    const checkedAt = new Date(Date.now() - 3 * 24 * 3600_000).toISOString();

    renderView({ entries: [entry({ issueId: "a", checkedAt })], checkedAt });

    // The header is the queue-wide stamp; the row carries its own, because a
    // bounded check pass can skip an issue and leave one row older than the rest.
    expect(await screen.findByText(/^Last checked 3d ago/)).toBeDefined();
    expect(screen.getByText(/^checked 3d ago$/)).toBeDefined();
  });

  it("runs exactly one check on mount and none on a re-render", async () => {
    const { fetchMock, view } = renderView({
      entries: [entry({ issueId: "a" })],
      checkedAt: new Date().toISOString(),
    });

    await waitFor(() =>
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1)
    );

    // A second render pass must not turn into a second pass over the provider.
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <FollowUpView onOpenIssue={vi.fn()} />
      </QueryClientProvider>
    );

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("wires Review and Stop to the follow-up route for the right issue", async () => {
    const { fetchMock } = renderView({
      entries: [entry({ issueId: "issue-7", reason: "reply", due: true })],
      checkedAt: new Date().toISOString(),
    });

    const row = (await screen.findByText("Checkout returns 500 on retry")).closest("li");
    expect(row).not.toBeNull();

    fireEvent.click(within(row!).getByRole("button", { name: "Review" }));

    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
      expect(puts).toHaveLength(1);
      expect(String(puts[0][0])).toBe("/api/issues/issue-7/follow-up");
      expect(JSON.parse(String(puts[0][1]?.body))).toEqual({ action: "review" });
    });

    fireEvent.click(within(row!).getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
      expect(puts).toHaveLength(2);
      expect(JSON.parse(String(puts[1][1]?.body))).toEqual({ action: "stop" });
    });
  });

  it("keeps the review pair on the URL when the caller knows the comment", async () => {
    // The list payload carries no comment id, so the view's own Review records
    // "I looked". The hook still has to build the pair correctly for a caller
    // that does know it, which is what the detail pane does.
    const { useFollowUpAction } = await import("@/features/follow-up/use-follow-ups");
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return json({ ok: true });
    }) as typeof fetch;

    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const { renderHook, waitFor: wait } = await import("@testing-library/react");
    const { result } = renderHook(() => useFollowUpAction("issue-9"), {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    });

    result.current.mutate({
      action: "review",
      trigger: { commentId: "9007199254740993", commentAt: "2026-03-02T10:00:00.000Z" },
    });

    await wait(() => expect(result.current.isSuccess).toBe(true));
    expect(calls).toHaveLength(1);
    const url = String(calls[0][0]);
    expect(url).toContain("/api/issues/issue-9/follow-up?");
    expect(url).toContain("commentId=9007199254740993");
    expect(url).toContain("commentAt=2026-03-02T10%3A00%3A00.000Z");
  });

  it("opens an entry in the detail pane when it is clicked", async () => {
    const { onOpenIssue } = renderView({
      entries: [entry({ issueId: "issue-3", title: "Click me" })],
      checkedAt: new Date().toISOString(),
    });

    fireEvent.click(await screen.findByRole("button", { name: "Click me" }));

    expect(onOpenIssue).toHaveBeenCalledTimes(1);
    expect(onOpenIssue.mock.calls[0][0].issueId).toBe("issue-3");
  });

  it("does not offer Review or Stop on a row that is no longer waiting", async () => {
    renderView({
      entries: [entry({ issueId: "a", state: "stopped", title: "Stopped issue" })],
      checkedAt: new Date().toISOString(),
    });

    const row = (await screen.findByText("Stopped issue")).closest("li");
    expect(within(row!).getByRole("button", { name: "Review" }).hasAttribute("disabled")).toBe(
      true
    );
    expect(within(row!).getByRole("button", { name: "Stop" }).hasAttribute("disabled")).toBe(true);
    expect(within(row!).getByRole("button", { name: "Wait again" })).toBeDefined();
  });

  it("explains that a follow-up is not a snooze", async () => {
    renderView({ entries: [], checkedAt: null });

    expect(await screen.findByText(/Nothing is being followed yet/)).toBeDefined();
    expect(screen.getByText(/Snoozing an issue does not stop it coming back here/)).toBeDefined();
  });

  it("surfaces the server's failure sentence instead of an empty list", async () => {
    global.fetch = vi.fn(async () =>
      json({ error: "No provider token available" }, 403)
    ) as unknown as typeof fetch;

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <FollowUpView onOpenIssue={vi.fn()} />
      </QueryClientProvider>
    );

    // The list shows its own failure and the check pass shows its own; both are
    // legitimate, so the assertion names the sentence rather than picking
    // whichever alert happened to render first.
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((alert) => alert.textContent?.includes("No provider token available"))).toBe(
      true
    );
  });
});
