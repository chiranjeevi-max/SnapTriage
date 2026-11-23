/**
 * @module tests/unit/features/inbox/issue-sort
 *
 * Queue ordering. The rule that matters most is totality: a bulk action stamps
 * several issues in the same millisecond, and an unstable order there makes rows
 * swap under `j` while the user is reading them.
 */
import { describe, expect, it } from "vitest";
import { ISSUE_SORTS, isIssueSort, sortIssues, type IssueSort } from "@/features/inbox/issue-sort";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

function issue(overrides: Partial<IssueWithTriage> = {}): IssueWithTriage {
  return {
    id: overrides.id ?? "issue",
    repoId: "repo-1",
    provider: "github",
    number: overrides.number ?? 1,
    title: "Title",
    author: "nadia",
    authorAvatar: null,
    state: "open",
    labels: [],
    assignees: [],
    url: "https://example.test/1",
    providerIssueId: "gh-1",
    createdAt: overrides.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-01-02T00:00:00.000Z",
    fetchedAt: "2026-01-02T00:00:00.000Z",
    triage: overrides.triage ?? null,
    ...overrides,
  };
}

function triage(overrides: Partial<NonNullable<IssueWithTriage["triage"]>> = {}) {
  return {
    id: "triage",
    priority: null,
    snoozedUntil: null,
    dismissed: false,
    ...overrides,
  };
}

const THREE = [
  issue({ id: "middle", number: 5, updatedAt: "2026-01-05T00:00:00.000Z" }),
  issue({ id: "newest", number: 9, updatedAt: "2026-01-09T00:00:00.000Z" }),
  issue({ id: "oldest", number: 2, updatedAt: "2026-01-02T00:00:00.000Z" }),
];

describe("isIssueSort", () => {
  it("accepts every offered sort and nothing else", () => {
    for (const option of ISSUE_SORTS) {
      expect(isIssueSort(option.value)).toBe(true);
    }
    expect(isIssueSort("nonsense")).toBe(false);
    expect(isIssueSort(null)).toBe(false);
  });
});

describe("sortIssues", () => {
  /**
   * @target sortIssues
   * @dependencies none
   * @scenario The default ordering
   * @expectedOutput Newest-updated first, with equal instants broken by id so a
   *                 refetch cannot reorder rows under the keyboard selection
   */
  it("orders newest-updated first without changing the input", () => {
    const sorted = sortIssues(THREE, "updated");

    expect(sorted.map((row) => row.id)).toEqual(["newest", "middle", "oldest"]);
    expect(THREE.map((row) => row.id)).toEqual(["middle", "newest", "oldest"]);
  });

  /**
   * @target sortIssues
   * @dependencies none
   * @scenario Two issues in different repositories share a number and an instant
   * @expectedOutput One fixed order on every run. An issue number is unique only
   *                 within a repository, so it cannot be the final tie-break.
   */
  it("breaks a shared number and timestamp by id", () => {
    const same = "2026-01-05T00:00:00.000Z";
    const rows = [
      issue({ id: "zzz", number: 12, updatedAt: same }),
      issue({ id: "aaa", number: 12, updatedAt: same }),
    ];

    expect(sortIssues(rows, "number").map((row) => row.id)).toEqual(["aaa", "zzz"]);
    expect(sortIssues(rows, "updated").map((row) => row.id)).toEqual(["aaa", "zzz"]);
  });

  it("orders oldest-updated first", () => {
    expect(sortIssues(THREE, "oldest-untouched").map((row) => row.id)).toEqual([
      "oldest",
      "middle",
      "newest",
    ]);
  });

  it("orders newest-created first", () => {
    const rows = [
      issue({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" }),
      issue({ id: "b", createdAt: "2026-03-01T00:00:00.000Z" }),
    ];

    expect(sortIssues(rows, "created").map((row) => row.id)).toEqual(["b", "a"]);
  });

  it("orders by issue number", () => {
    expect(sortIssues(THREE, "number").map((row) => row.number)).toEqual([2, 5, 9]);
  });

  /**
   * @target sortIssues
   * @dependencies none
   * @scenario Untriaged rows sit among triaged ones
   * @expectedOutput Untriaged rows lead, newest first among themselves, so a
   *                 fresh arrival still tops the list it exists to top.
   */
  it("floats untriaged issues to the top", () => {
    const rows = [
      issue({ id: "triaged", number: 1, triage: triage({ priority: 2 }) }),
      issue({ id: "fresh", number: 2, updatedAt: "2026-02-01T00:00:00.000Z" }),
      issue({ id: "older-fresh", number: 3, updatedAt: "2026-01-15T00:00:00.000Z" }),
    ];

    expect(sortIssues(rows, "untriaged").map((row) => row.id)).toEqual([
      "fresh",
      "older-fresh",
      "triaged",
    ]);
  });

  it("treats a snoozed or dismissed issue as triaged", () => {
    const rows = [
      issue({
        id: "snoozed",
        number: 1,
        triage: triage({ snoozedUntil: "2026-12-01T00:00:00.000Z" }),
      }),
      issue({ id: "dismissed", number: 2, triage: triage({ dismissed: true }) }),
      issue({ id: "untouched", number: 3 }),
    ];

    expect(sortIssues(rows, "untriaged").map((row) => row.id)).toEqual([
      "untouched",
      "snoozed",
      "dismissed",
    ]);
  });

  /**
   * @target sortIssues
   * @dependencies none
   * @scenario Two issues share a timestamp, as a bulk action produces
   * @expectedOutput A stable, meaningful order rather than whichever the engine
   *                 reaches first, so rows do not swap under `j`.
   */
  it("breaks timestamp ties by issue number", () => {
    const same = "2026-01-05T00:00:00.000Z";
    const rows = [
      issue({ id: "b", number: 22, updatedAt: same }),
      issue({ id: "a", number: 11, updatedAt: same }),
    ];

    expect(sortIssues(rows, "oldest-untouched").map((row) => row.id)).toEqual(["a", "b"]);
    expect(sortIssues(rows, "created").map((row) => row.id)).toEqual(["a", "b"]);
  });

  /**
   * @target sortIssues
   * @dependencies none
   * @scenario An issue carries an unparseable timestamp
   * @expectedOutput The comparator still returns a number. `NaN` from a bad date
   *                 would leave the entire array in an arbitrary order.
   */
  it("survives an unparseable timestamp", () => {
    // `broken` is deliberately second in the input. If the comparator returned
    // `NaN`, `Array.sort` leaves the array as it found it, so a membership-only
    // assertion would still pass. The expected order is the assertion.
    const rows = [
      issue({ id: "fine", number: 1, updatedAt: "2026-01-05T00:00:00.000Z" }),
      issue({ id: "broken", number: 3, updatedAt: "not-a-date" }),
    ];

    // A bad timestamp reads as epoch 0, which is the oldest possible instant.
    expect(sortIssues(rows, "oldest-untouched").map((row) => row.id)).toEqual(["broken", "fine"]);
  });

  it("never mutates the input", () => {
    const rows = [...THREE];
    const before = rows.map((row) => row.id);

    for (const sort of ISSUE_SORTS.map((option) => option.value) as IssueSort[]) {
      sortIssues(rows, sort);
    }

    expect(rows.map((row) => row.id)).toEqual(before);
  });
});
