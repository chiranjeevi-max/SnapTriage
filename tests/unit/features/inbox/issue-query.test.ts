/**
 * @module tests/unit/features/inbox/issue-query
 *
 * The inbox query bar. The rules that matter are the forgiving ones: an
 * unrecognised `field:value` has to search as text rather than match nothing,
 * and every term has to hold, so adding a word always narrows.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_QUERY,
  filterByQuery,
  isEmptyQuery,
  matchesQuery,
  parseQuery,
} from "@/features/inbox/issue-query";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

function issue(overrides: Partial<IssueWithTriage> = {}): IssueWithTriage {
  return {
    id: "issue-1",
    repoId: "repo-1",
    provider: "github",
    number: 123,
    title: "Crash when saving a draft",
    author: "nadia",
    authorAvatar: null,
    state: "open",
    labels: ["bug", "P1"],
    assignees: ["octocat"],
    url: "https://github.com/acme/widgets/issues/123",
    providerIssueId: "gh-123",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    fetchedAt: "2026-01-02T00:00:00.000Z",
    triage: null,
    ...overrides,
  };
}

describe("parseQuery", () => {
  it("treats bare words as free text, lower-cased", () => {
    expect(parseQuery("Crash SAVE").terms).toEqual(["crash", "save"]);
  });

  it("reads each field prefix", () => {
    const query = parseQuery("label:Bug author:nadia assignee:Octocat is:closed");

    expect(query.labels).toEqual(["bug"]);
    expect(query.authors).toEqual(["nadia"]);
    expect(query.assignees).toEqual(["octocat"]);
    expect(query.state).toBe("closed");
  });

  it("reads an issue number", () => {
    expect(parseQuery("#123").numbers).toEqual([123]);
  });

  it("keeps a quoted value as one term", () => {
    expect(parseQuery('label:"needs triage"').labels).toEqual(["needs triage"]);
  });

  /**
   * A title with a colon in it is ordinary prose. Rejecting it, or treating the
   * prefix as unknown and dropping it, would make the query match nothing.
   */
  it("falls back to free text for an unknown prefix", () => {
    expect(parseQuery("fix: crash")).toEqual({
      ...EMPTY_QUERY,
      terms: ["fix:", "crash"],
    });
  });

  it("falls back to free text for a known prefix with no value", () => {
    expect(parseQuery("label:").terms).toEqual(["label:"]);
  });

  it("falls back to free text for an `is:` value it does not know", () => {
    expect(parseQuery("is:stale").terms).toEqual(["is:stale"]);
  });
});

describe("isEmptyQuery", () => {
  it("is empty for blank input", () => {
    expect(isEmptyQuery(parseQuery(""))).toBe(true);
    expect(isEmptyQuery(parseQuery("   "))).toBe(true);
  });

  it("is not empty once a constraint exists", () => {
    expect(isEmptyQuery(parseQuery("crash"))).toBe(false);
    expect(isEmptyQuery(parseQuery("is:open"))).toBe(false);
  });
});

describe("matchesQuery", () => {
  it("matches everything for an empty query", () => {
    expect(matchesQuery(issue(), EMPTY_QUERY)).toBe(true);
  });

  it("matches free text against the title, case-insensitively", () => {
    expect(matchesQuery(issue(), parseQuery("CRASH"))).toBe(true);
    expect(matchesQuery(issue(), parseQuery("nonexistent"))).toBe(false);
  });

  it("matches free text against the author and the labels", () => {
    expect(matchesQuery(issue(), parseQuery("nadia"))).toBe(true);
    expect(matchesQuery(issue(), parseQuery("bug"))).toBe(true);
  });

  /**
   * Every term must hold. If adding a word widened the result the bar would be
   * useless for narrowing a large queue.
   */
  it("requires every free-text term", () => {
    expect(matchesQuery(issue(), parseQuery("crash draft"))).toBe(true);
    expect(matchesQuery(issue(), parseQuery("crash nonsense"))).toBe(false);
  });

  it("filters by label, author and assignee", () => {
    expect(matchesQuery(issue(), parseQuery("label:bug"))).toBe(true);
    expect(matchesQuery(issue(), parseQuery("label:chore"))).toBe(false);
    expect(matchesQuery(issue(), parseQuery("author:nadia"))).toBe(true);
    expect(matchesQuery(issue(), parseQuery("author:octocat"))).toBe(false);
    expect(matchesQuery(issue(), parseQuery("assignee:octocat"))).toBe(true);
    expect(matchesQuery(issue(), parseQuery("assignee:nadia"))).toBe(false);
  });

  it("filters by state", () => {
    expect(matchesQuery(issue(), parseQuery("is:open"))).toBe(true);
    expect(matchesQuery(issue(), parseQuery("is:closed"))).toBe(false);
  });

  it("filters by issue number", () => {
    expect(matchesQuery(issue(), parseQuery("#123"))).toBe(true);
    expect(matchesQuery(issue(), parseQuery("#124"))).toBe(false);
  });

  /**
   * @target matchesQuery
   * @dependencies none
   * @scenario Two issue numbers in one query
   * @expectedOutput Nothing, because every constraint is an AND and an issue has
   *                 one number. A union here would be the only field that widens
   *                 when a term is added.
   */
  it("treats repeated numbers as an intersection", () => {
    expect(matchesQuery(issue(), parseQuery("#123 #124"))).toBe(false);
    expect(matchesQuery(issue(), parseQuery("#123 #123"))).toBe(true);
  });

  it("combines a field and free text", () => {
    expect(matchesQuery(issue(), parseQuery("label:bug crash"))).toBe(true);
    expect(matchesQuery(issue(), parseQuery("label:chore crash"))).toBe(false);
  });

  it("does not match an issue with no author", () => {
    expect(matchesQuery(issue({ author: null }), parseQuery("nadia"))).toBe(false);
  });
});

describe("filterByQuery", () => {
  /**
   * @target filterByQuery
   * @dependencies none
   * @scenario An empty query
   * @expectedOutput The same array instance, so the caller does not re-render
   *                 the list for a filter that cannot remove anything
   */
  it("returns the input untouched for an empty query", () => {
    const issues = [issue()];

    expect(filterByQuery(issues, EMPTY_QUERY)).toBe(issues);
  });

  it("preserves queue order while narrowing", () => {
    const issues = [
      issue({ id: "a", title: "first crash" }),
      issue({ id: "b", title: "unrelated" }),
      issue({ id: "c", title: "second crash" }),
    ];

    expect(filterByQuery(issues, parseQuery("crash")).map((row) => row.id)).toEqual(["a", "c"]);
  });
});
