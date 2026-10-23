import { describe, it, expect } from "vitest";
import type { IssueDetail } from "\@/features/inbox/use-issues";

import { matchesIssueFilter } from "@/features/inbox/issue-filters";

function issue(overrides: Partial<IssueDetail> = {}): IssueDetail {
  return {
    id: "i1",
    repoId: "r1",
    provider: "github",
    number: 1,
    title: "Test",
    body: null,
    author: "alice",
    authorAvatar: null,
    state: "open",
    labels: [],
    assignees: [],
    url: "https://example.com",
    providerIssueId: "1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    triage: null,
    ...overrides,
  };
}

describe("matchesIssueFilter", () => {
  it("keeps open, active issues under the open filter", () => {
    expect(matchesIssueFilter(issue(), "open")).toBe(true);
  });

  it("excludes dismissed issues from open", () => {
    expect(
      matchesIssueFilter(
        issue({ triage: { id: "t", priority: null, snoozedUntil: null, dismissed: true } }),
        "open"
      )
    ).toBe(false);
  });

  it("selects snoozed issues only", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const item = issue({
      triage: { id: "t", priority: null, snoozedUntil: future, dismissed: false },
    });
    expect(matchesIssueFilter(item, "snoozed")).toBe(true);
    expect(matchesIssueFilter(item, "open")).toBe(false);
  });

  it("selects urgent priority issues", () => {
    const item = issue({ triage: { id: "t", priority: 1, snoozedUntil: null, dismissed: false } });
    expect(matchesIssueFilter(item, "urgent")).toBe(true);
  });
});
