/**
 * @module tests/unit/pending-changes
 *
 * Unit tests for {@link mergePendingChanges}.
 * Validates correct merging of triage payloads including:
 * - Priority set/clear/override
 * - Label add/remove with cancellation of conflicting operations
 * - Multi-step label change sequences
 * - Assignee add/remove with cancellation
 * - Dismissed and snoozedUntil flags
 * - Preservation of unrelated fields during merge
 * - State open/close overriding
 */
import { describe, it, expect } from "vitest";
import { mergePendingChanges, type PendingChanges } from "@/features/triage/types";

describe("mergePendingChanges", () => {
  it("merges priority into empty pending", () => {
    const result = mergePendingChanges({}, { priority: 1 });
    expect(result.priority).toBe(1);
  });

  it("overrides existing priority", () => {
    const result = mergePendingChanges({ priority: 1 }, { priority: 2 });
    expect(result.priority).toBe(2);
  });

  it("clears priority with null", () => {
    const result = mergePendingChanges({ priority: 1 }, { priority: null });
    expect(result.priority).toBeNull();
  });

  it("merges state changes", () => {
    const result = mergePendingChanges({}, { state: "closed" });
    expect(result.state).toBe("closed");
  });

  it("overrides existing state", () => {
    const result = mergePendingChanges({ state: "open" }, { state: "closed" });
    expect(result.state).toBe("closed");
  });

  it("merges label adds", () => {
    const existing: PendingChanges = { labels: { add: ["bug"], remove: [] } };
    const result = mergePendingChanges(existing, { labels: { add: ["urgent"] } });
    expect(result.labels?.add).toContain("bug");
    expect(result.labels?.add).toContain("urgent");
    expect(result.labels?.remove).toEqual([]);
  });

  it("cancels a pending add when removing the same label", () => {
    const existing: PendingChanges = { labels: { add: ["bug"], remove: [] } };
    const result = mergePendingChanges(existing, { labels: { remove: ["bug"] } });
    expect(result.labels?.add).not.toContain("bug");
    // "bug" was only a pending add, so remove list stays empty
    expect(result.labels?.remove).toEqual([]);
  });

  it("cancels a pending remove when adding the same label", () => {
    const existing: PendingChanges = { labels: { add: [], remove: ["bug"] } };
    const result = mergePendingChanges(existing, { labels: { add: ["bug"] } });
    expect(result.labels?.add).toContain("bug");
    expect(result.labels?.remove).not.toContain("bug");
  });

  it("handles multi-step label changes correctly", () => {
    let pending: PendingChanges = {};

    // Step 1: add "bug"
    pending = mergePendingChanges(pending, { labels: { add: ["bug"] } });
    expect(pending.labels).toEqual({ add: ["bug"], remove: [] });

    // Step 2: add "urgent"
    pending = mergePendingChanges(pending, { labels: { add: ["urgent"] } });
    expect(pending.labels?.add).toContain("bug");
    expect(pending.labels?.add).toContain("urgent");

    // Step 3: remove "bug"; this cancels the previous add
    pending = mergePendingChanges(pending, { labels: { remove: ["bug"] } });
    expect(pending.labels?.add).toEqual(["urgent"]);
    expect(pending.labels?.remove).toEqual([]);
  });

  it("merges assignee adds", () => {
    const existing: PendingChanges = { assignees: { add: ["alice"], remove: [] } };
    const result = mergePendingChanges(existing, { assignees: { add: ["bob"] } });
    expect(result.assignees?.add).toContain("alice");
    expect(result.assignees?.add).toContain("bob");
  });

  it("cancels pending assignee add when removing same user", () => {
    const existing: PendingChanges = { assignees: { add: ["alice"], remove: [] } };
    const result = mergePendingChanges(existing, { assignees: { remove: ["alice"] } });
    expect(result.assignees?.add).not.toContain("alice");
    // "alice" was only a pending add, so remove list stays empty
    expect(result.assignees?.remove).toEqual([]);
  });

  /**
   * @target mergePendingChanges
   * @dependencies none
   * @scenario A pending addition and a removal name the same login in different
   *           cases, as GitHub and GitLab do
   * @expectedOutput The addition is cancelled and nothing is staged: the login
   *                 was never applied upstream, so there is nothing to remove.
   *                 A case-sensitive comparison would leave both, and the push
   *                 would add and remove the same account.
   */
  it("cancels a pending assignee add across case variants", () => {
    const existing: PendingChanges = { assignees: { add: ["Jo"], remove: [] } };
    const result = mergePendingChanges(existing, { assignees: { remove: ["jo"] } });
    expect(result.assignees?.add).toEqual([]);
    expect(result.assignees?.remove).toEqual([]);
  });

  /**
   * @target mergePendingChanges
   * @dependencies none
   * @scenario A staged removal is cancelled by an addition in another case, and
   *           the issue already carries the login
   * @expectedOutput The removal comes back, because it is still a real removal
   *                 upstream. This is the undo of a preset that added the login
   *                 back over a staged removal.
   */
  it("restores a case-variant staged removal the apply cancelled", () => {
    const existing: PendingChanges = { assignees: { add: [], remove: ["jo"] } };
    const applied = mergePendingChanges(existing, { assignees: { add: ["Jo"] } }, [], ["jo"]);
    expect(applied.assignees).toEqual({ add: ["Jo"], remove: [] });

    const undo = mergePendingChanges(applied, { assignees: { remove: ["jo"] } }, [], ["jo"]);
    expect(undo.assignees).toEqual({ add: [], remove: ["jo"] });
  });

  /**
   * @target mergePendingChanges
   * @dependencies none
   * @scenario Two casings of the same login are staged as additions
   * @expectedOutput One entry, so a later removal cancels the whole addition
   *                 rather than leaving a variant to reach the provider.
   */
  it("keeps one pending assignee addition across case variants", () => {
    const first = mergePendingChanges({}, { assignees: { add: ["Jo"] } });
    const second = mergePendingChanges(first, { assignees: { add: ["jo"] } });
    expect(second.assignees?.add).toEqual(["jo"]);
  });

  it("merges dismissed flag", () => {
    const result = mergePendingChanges({}, { dismissed: true });
    expect(result.dismissed).toBe(true);
  });

  it("merges snoozedUntil", () => {
    const ts = "2026-03-01T09:00:00.000Z";
    const result = mergePendingChanges({}, { snoozedUntil: ts });
    expect(result.snoozedUntil).toBe(ts);
  });

  it("preserves unrelated fields when merging", () => {
    const existing: PendingChanges = { priority: 1, dismissed: false };
    const result = mergePendingChanges(existing, { labels: { add: ["bug"] } });
    expect(result.priority).toBe(1);
    expect(result.dismissed).toBe(false);
    expect(result.labels?.add).toContain("bug");
  });
});
