/**
 * @module tests/unit/features/triage/selection
 *
 * Bulk-selection arithmetic. The rule worth pinning is that a selection outlives
 * what is on screen but an *action* may only touch what is visible: acting on a
 * hidden row is something the user cannot connect to the keystroke.
 */
import { describe, expect, it } from "vitest";
import { toggleSelectAll, toggleSelected, visibleSelection } from "@/features/triage/selection";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

function issue(id: string): IssueWithTriage {
  return {
    id,
    repoId: "repo-1",
    provider: "github",
    number: 1,
    title: "Title",
    author: "nadia",
    authorAvatar: null,
    state: "open",
    labels: [],
    assignees: [],
    url: "https://example.test/1",
    providerIssueId: `gh-${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    fetchedAt: "2026-01-02T00:00:00.000Z",
    triage: null,
  };
}

describe("toggleSelected", () => {
  it("adds an unselected row", () => {
    expect([...toggleSelected(new Set(), "a")]).toEqual(["a"]);
  });

  it("removes a selected row", () => {
    expect([...toggleSelected(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });

  it("never mutates the input", () => {
    const selected = new Set(["a"]);
    toggleSelected(selected, "b");

    expect([...selected]).toEqual(["a"]);
  });
});

describe("toggleSelectAll", () => {
  it("selects every visible row", () => {
    const result = toggleSelectAll(new Set(), [issue("a"), issue("b")]);

    expect([...result].sort()).toEqual(["a", "b"]);
  });

  /**
   * Selecting all twice must not be a no-op: the second press is the only way to
   * undo a select-all without clearing the whole selection by hand.
   */
  it("clears the visible rows when they are all already selected", () => {
    const result = toggleSelectAll(new Set(["a", "b"]), [issue("a"), issue("b")]);

    expect(result.size).toBe(0);
  });

  /**
   * @target toggleSelectAll
   * @dependencies none
   * @scenario Every visible row is selected, and a hidden row is selected too
   * @expectedOutput Only the visible rows are cleared. Wiping the whole set
   *                 discarded a selection the user made before filtering, which
   *                 is work they cannot see and did not ask to lose.
   */
  it("keeps hidden rows when clearing the visible ones", () => {
    const result = toggleSelectAll(new Set(["hidden", "a"]), [issue("a")]);

    expect([...result]).toEqual(["hidden"]);
  });

  /**
   * A row the user selected before changing the filter is deliberate work. It is
   * off screen, so it will not be acted on, but discarding it here would lose the
   * selection for no reason the user can see.
   */
  it("keeps rows that are off screen", () => {
    const result = toggleSelectAll(new Set(["hidden"]), [issue("a")]);

    expect([...result].sort()).toEqual(["a", "hidden"]);
  });

  /**
   * With nothing visible, "select all" must not clear a selection the user made
   * on a surface they have since filtered away from.
   */
  it("does not clear on an empty list", () => {
    const result = toggleSelectAll(new Set(["a"]), []);

    expect([...result]).toEqual(["a"]);
  });
});

describe("visibleSelection", () => {
  it("returns visible rows in queue order, not click order", () => {
    const visible = [issue("a"), issue("b"), issue("c")];

    expect(visibleSelection(new Set(["c", "a"]), visible)).toEqual(["a", "c"]);
  });

  it("omits selected rows that are not visible", () => {
    expect(visibleSelection(new Set(["a", "hidden"]), [issue("a")])).toEqual(["a"]);
  });

  it("is empty for an empty selection", () => {
    expect(visibleSelection(new Set(), [issue("a")])).toEqual([]);
  });
});
