/**
 * @module tests/unit/features/inbox/issue-list
 * Keyboard selection delegates scrolling to the virtualizer, which knows when
 * the queue has been measured after a responsive pane becomes visible.
 */
/* @vitest-environment jsdom */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVirtualizer } from "@tanstack/react-virtual";
import { IssueList } from "@/features/inbox/components/issue-list";
import { WORST_CASE_ISSUES } from "@/features/dev-tools/fixtures";
import { shortenRepoName } from "@/features/repos/repo-label";

const { scrollToIndex } = vi.hoisted(() => ({ scrollToIndex: vi.fn() }));

vi.mock("@tanstack/react-virtual", () => ({
  measureElement: vi.fn(() => 0),
  useVirtualizer: vi.fn(() => ({
    scrollToIndex,
    measureElement: vi.fn(),
    getTotalSize: () => 300,
    getVirtualItems: () => [
      { key: "first", index: 0, start: 0 },
      { key: "second", index: 1, start: 150 },
    ],
  })),
}));

describe("IssueList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps keyboard scrolling owned by the virtualizer", () => {
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;
    const props = {
      issues: WORST_CASE_ISSUES.slice(0, 2),
      onSelect: vi.fn(),
      isLoading: false,
    };
    const { rerender } = render(<IssueList {...props} selectedIndex={0} />);
    rerender(<IssueList {...props} selectedIndex={1} />);

    expect(scrollToIndex).toHaveBeenLastCalledWith(1, { align: "auto" });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("retains an estimated size while a responsive pane is hidden", () => {
    render(
      <IssueList
        issues={WORST_CASE_ISSUES.slice(0, 2)}
        onSelect={vi.fn()}
        isLoading={false}
        selectedIndex={0}
      />
    );
    const options = vi.mocked(useVirtualizer).mock.calls[0][0];
    const instance = vi.mocked(useVirtualizer).mock.results[0].value;
    expect(options.measureElement).toBeDefined();
    expect(options.measureElement!(document.createElement("div"), undefined, instance)).toBe(
      options.estimateSize(0)
    );
  });

  it("names the repository a row comes from", () => {
    const full = "group/subgroup/second-subgroup/project-with-a-very-long-name";
    render(
      <IssueList
        issues={WORST_CASE_ISSUES.slice(0, 2)}
        onSelect={vi.fn()}
        isLoading={false}
        selectedIndex={0}
        repoNames={new Map([["r1", full]])}
      />
    );

    const labels = screen.getAllByText(shortenRepoName(full));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((label) => label.getAttribute("title") === full)).toBe(true);
  });

  it("distinguishes an empty queue from a narrowing that hides every issue", () => {
    const onClearNarrowing = vi.fn();
    render(
      <IssueList
        issues={[]}
        onSelect={vi.fn()}
        isLoading={false}
        selectedIndex={0}
        narrowedBy={["the search “zzzz”"]}
        onClearNarrowing={onClearNarrowing}
      />
    );

    expect(screen.getByText("No issues match")).toBeDefined();
    expect(screen.queryByText("No issues to triage")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(onClearNarrowing).toHaveBeenCalledOnce();
  });

  it("offers the repository action only when the queue has never had issues", () => {
    render(<IssueList issues={[]} onSelect={vi.fn()} isLoading={false} selectedIndex={0} />);

    expect(screen.getByText("No issues to triage")).toBeDefined();
    expect(screen.queryByText("No issues match")).toBeNull();

    const connect = screen.getByRole("link", { name: "Connect a repository" });
    expect(connect.getAttribute("href")).toBe("/repos");
  });

  it("keeps one tab stop per row and declares the full set size", () => {
    render(
      <IssueList
        issues={WORST_CASE_ISSUES.slice(0, 2)}
        onSelect={vi.fn()}
        isLoading={false}
        selectedIndex={0}
        onToggleSelected={vi.fn()}
      />
    );

    const checkbox = screen.getByRole("checkbox", { name: "Select issue #999999" });
    expect(checkbox.tabIndex).toBe(-1);

    const items = screen.getAllByRole("listitem");
    expect(items[0].getAttribute("aria-setsize")).toBe("2");
    expect(items[0].getAttribute("aria-posinset")).toBe("1");
  });
});
