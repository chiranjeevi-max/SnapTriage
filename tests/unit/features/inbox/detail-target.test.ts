/**
 * @module tests/unit/features/inbox/detail-target
 *
 * Which issue the detail pane renders. The pane and the keyboard both key off the
 * same answer, so a mismatch does not look like a bug in either one — it looks
 * like a shortcut dismissing a row the user never selected.
 */
import { describe, it, expect } from "vitest";
import { resolveDetailTarget } from "@/features/inbox/components/inbox-view";
import type { FollowUpEntry } from "@/features/follow-up/use-follow-ups";
import type { IssueDetailTarget } from "@/features/inbox/components/issue-detail";

/** A pinned follow-up pointing at a closed issue the queue does not contain. */
const PINNED: FollowUpEntry = {
  issueId: "closed-issue",
  repoId: "repo-1",
  number: 42,
  title: "Closed but waiting",
  url: "https://github.com/octo/repo/issues/42",
  provider: "github",
  fullName: "octo/repo",
  state: "waiting",
  reason: null,
  checkedAt: null,
  due: false,
};

/** The row the queue selection points at. */
const QUEUE_ROW = {
  id: "open-issue",
  provider: "github",
  url: "https://github.com/octo/repo/issues/7",
  number: 7,
  title: "Open issue",
} as IssueDetailTarget;

describe("resolveDetailTarget", () => {
  /**
   * @target resolveDetailTarget
   * @dependencies none
   * @scenario A queue row is selected while a follow-up is still pinned
   * @expectedOutput The queue row. Selecting with the keyboard after pinning must
   *                 move the pane, otherwise the shortcuts act on a row that is
   *                 not the one on screen.
   */
  it("should prefer the selected queue row over a pin", () => {
    expect(resolveDetailTarget(PINNED, QUEUE_ROW)).toBe(QUEUE_ROW);
  });

  /**
   * @target resolveDetailTarget
   * @dependencies none
   * @scenario A follow-up is pinned and nothing in the queue is selected
   * @expectedOutput The pin, mapped into the pane's shape. A closed issue has no
   *                 queue row, so the pin is the only way to display it.
   */
  it("should fall back to the pinned follow-up", () => {
    expect(resolveDetailTarget(PINNED, null)).toEqual({
      id: "closed-issue",
      provider: "github",
      url: "https://github.com/octo/repo/issues/42",
      number: 42,
      title: "Closed but waiting",
    });
  });

  /**
   * @target resolveDetailTarget
   * @dependencies none
   * @scenario Nothing is selected or pinned — after closing the pane
   * @expectedOutput `null`, so the pane shows its empty state rather than the
   *                 last thing that was open.
   */
  it("should return null when nothing is selected", () => {
    expect(resolveDetailTarget(null, null)).toBeNull();
  });
});
