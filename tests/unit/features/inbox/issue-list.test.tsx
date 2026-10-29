/**
 * @module tests/unit/features/inbox/issue-list
 * Keyboard selection delegates scrolling to the virtualizer, which knows when
 * the queue has been measured after a responsive pane becomes visible.
 */
/* @vitest-environment jsdom */
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useVirtualizer } from "@tanstack/react-virtual";
import { IssueList } from "@/features/inbox/components/issue-list";
import { WORST_CASE_ISSUES } from "@/features/dev-tools/fixtures";

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
});
