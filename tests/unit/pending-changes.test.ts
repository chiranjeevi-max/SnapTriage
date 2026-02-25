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

    // Step 3: remove "bug" — cancels the previous add
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
