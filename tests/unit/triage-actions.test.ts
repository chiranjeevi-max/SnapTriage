import { describe, it, expect } from "vitest";
import {
  setPriority,
  addLabel,
  removeLabel,
  assignUser,
  unassignUser,
  snoozeIssue,
  unsnoozeIssue,
  dismissIssue,
} from "@/features/triage/triage-actions";

describe("triage-actions", () => {
  describe("setPriority", () => {
    it("returns a payload with the given priority", () => {
      expect(setPriority(0)).toEqual({ priority: 0 });
      expect(setPriority(3)).toEqual({ priority: 3 });
    });

    it("returns null priority to clear", () => {
      expect(setPriority(null)).toEqual({ priority: null });
    });
  });

  describe("addLabel", () => {
    it("returns payload to add a label", () => {
      expect(addLabel("bug")).toEqual({ labels: { add: ["bug"], remove: [] } });
    });
  });

  describe("removeLabel", () => {
    it("returns payload to remove a label", () => {
      expect(removeLabel("bug")).toEqual({ labels: { add: [], remove: ["bug"] } });
    });
  });

  describe("assignUser", () => {
    it("returns payload to assign a user", () => {
      expect(assignUser("alice")).toEqual({ assignees: { add: ["alice"], remove: [] } });
    });
  });

  describe("unassignUser", () => {
    it("returns payload to unassign a user", () => {
      expect(unassignUser("alice")).toEqual({ assignees: { add: [], remove: ["alice"] } });
    });
  });

  describe("snoozeIssue", () => {
    it("returns payload with snoozedUntil", () => {
      const ts = "2026-03-01T09:00:00.000Z";
      expect(snoozeIssue(ts)).toEqual({ snoozedUntil: ts });
    });
  });

  describe("unsnoozeIssue", () => {
    it("returns payload with null snoozedUntil", () => {
      expect(unsnoozeIssue()).toEqual({ snoozedUntil: null });
    });
  });

  describe("dismissIssue", () => {
    it("returns payload with dismissed flag", () => {
      expect(dismissIssue(true)).toEqual({ dismissed: true });
      expect(dismissIssue(false)).toEqual({ dismissed: false });
    });
  });
});
