/**
 * @module tests/unit/features/triage/pending-summary
 *
 * Describing a batch push before it happens. The rules that matter: a value must
 * not be listed twice for what is one provider operation, a push that sends
 * nothing must say so, and a long list must be summarised rather than dumped.
 */
import { describe, expect, it } from "vitest";
import {
  describePending,
  hasProviderChanges,
  summarizePending,
} from "@/features/triage/pending-summary";
import type { IssueWithTriage } from "@/features/inbox/use-issues";
import type { PendingChanges } from "@/features/triage/types";

let nextId = 0;

function issue(pendingChanges: PendingChanges | null): IssueWithTriage {
  return {
    id: `issue-${nextId++}`,
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
    providerIssueId: "gh-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    fetchedAt: "2026-01-02T00:00:00.000Z",
    triage: pendingChanges
      ? { id: "triage", priority: null, snoozedUntil: null, dismissed: false, pendingChanges }
      : null,
  };
}

describe("summarizePending", () => {
  it("is empty for a queue with nothing staged", () => {
    expect(summarizePending([issue(null)])).toEqual({
      issues: 0,
      labelsToAdd: [],
      labelsToRemove: [],
      assigneesToAdd: [],
      assigneesToRemove: [],
      stagedStates: 0,
      stagedPriorities: 0,
    });
  });

  it("counts only issues that carry staged changes", () => {
    const summary = summarizePending([
      issue(null),
      issue({ labels: { add: ["bug"], remove: [] } }),
      issue({}),
    ]);

    expect(summary.issues).toBe(2);
  });

  it("folds labels and assignees across issues", () => {
    const summary = summarizePending([
      issue({ labels: { add: ["bug"], remove: [] } }),
      issue({ labels: { add: ["chore"], remove: ["wontfix"] } }),
      issue({ assignees: { add: ["octocat"], remove: [] } }),
    ]);

    expect(summary.labelsToAdd).toEqual(["bug", "chore"]);
    expect(summary.labelsToRemove).toEqual(["wontfix"]);
    expect(summary.assigneesToAdd).toEqual(["octocat"]);
  });

  /**
   * @target summarizePending
   * @dependencies none
   * @scenario Two issues stage labels that differ only in case
   * @expectedOutput One entry. GitHub and GitLab treat `Bug` and `bug` as one
   *                 label, so listing both would describe a push sending a value
   *                 twice and overstate the work.
   */
  it("de-duplicates values case-insensitively", () => {
    const summary = summarizePending([
      issue({ labels: { add: ["Bug"], remove: [] } }),
      issue({ labels: { add: ["bug"], remove: [] } }),
      issue({ assignees: { add: ["Octocat"], remove: [] } }),
      issue({ assignees: { add: ["octocat"], remove: [] } }),
    ]);

    expect(summary.labelsToAdd).toEqual(["Bug"]);
    expect(summary.assigneesToAdd).toEqual(["Octocat"]);
  });

  it("counts staged state and priority changes", () => {
    const summary = summarizePending([
      issue({ state: "closed", priority: 1 }),
      issue({ state: "open" }),
    ]);

    expect(summary.stagedStates).toBe(2);
    expect(summary.stagedPriorities).toBe(1);
  });
});

describe("hasProviderChanges", () => {
  it("is false when only personal fields are staged", () => {
    expect(hasProviderChanges(summarizePending([issue({ priority: 2 })]))).toBe(false);
  });

  it("is true for a staged label", () => {
    expect(
      hasProviderChanges(summarizePending([issue({ labels: { add: ["bug"], remove: [] } })]))
    ).toBe(true);
  });

  it("is true for a staged state", () => {
    expect(hasProviderChanges(summarizePending([issue({ state: "closed" })]))).toBe(true);
  });
});

describe("describePending", () => {
  it("renders nothing when nothing is staged", () => {
    expect(describePending(summarizePending([issue(null)]))).toEqual([]);
  });

  it("names the values being added and removed", () => {
    const lines = describePending(
      summarizePending([
        issue({ labels: { add: ["bug"], remove: ["wontfix"] } }),
        issue({ assignees: { add: ["octocat"], remove: [] } }),
      ])
    );

    expect(lines).toEqual([
      { label: "Add labels", values: ["bug"] },
      { label: "Remove labels", values: ["wontfix"] },
      { label: "Assign", values: ["octocat"] },
    ]);
  });

  /**
   * @target describePending
   * @dependencies none
   * @scenario More values than one line can show
   * @expectedOutput The excess is counted rather than dropped, so the preview
   *                 never understates what a push will send.
   */
  it("summarises a long list instead of truncating it silently", () => {
    const lines = describePending(
      summarizePending([issue({ labels: { add: ["a", "b", "c", "d", "e"], remove: [] } })]),
      3
    );

    expect(lines[0]).toEqual({ label: "Add labels", values: ["a", "b", "c", "+2 more"] });
  });

  it("describes a state change without listing labels", () => {
    const lines = describePending(summarizePending([issue({ state: "closed" })]));

    expect(lines).toEqual([{ label: "Change state on 1 issue", values: [] }]);
  });

  /**
   * @target describePending
   * @dependencies none
   * @scenario Only personal fields are staged
   * @expectedOutput A line naming them. Priority never reaches the provider, but
   *                 the push still clears it, so omitting it made the preview
   *                 understate what the push settles.
   */
  it("names a staged priority even though it is not sent to the provider", () => {
    const lines = describePending(summarizePending([issue({ priority: 1 })]));

    expect(lines).toEqual([{ label: "Set priority on 1 issue", values: [] }]);
    expect(hasProviderChanges(summarizePending([issue({ priority: 1 })]))).toBe(false);
  });
});
