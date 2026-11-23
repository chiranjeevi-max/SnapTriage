import { describe, it, expect } from "vitest";
import { payloadToIssueUpdate } from "@/features/triage/types";

describe("payloadToIssueUpdate", () => {
  it("extracts labels from payload", () => {
    const payload = { labels: { add: ["bug"], remove: ["enhancement"] } };
    expect(payloadToIssueUpdate(payload)).toEqual({ labels: payload.labels });
  });

  it("extracts assignees from payload", () => {
    const payload = { assignees: { add: ["alice"], remove: ["bob"] } };
    expect(payloadToIssueUpdate(payload)).toEqual({ assignees: payload.assignees });
  });

  it("extracts state from payload", () => {
    expect(payloadToIssueUpdate({ state: "open" })).toEqual({ state: "open" });
    expect(payloadToIssueUpdate({ state: "closed" })).toEqual({ state: "closed" });
  });

  it("omits local-only fields like priority, dismissed, and snoozedUntil", () => {
    const payload = {
      priority: 1,
      dismissed: true,
      snoozedUntil: "2026-03-01T09:00:00.000Z",
      state: "closed" as const,
    };
    expect(payloadToIssueUpdate(payload)).toEqual({ state: "closed" });
  });

  it("returns an empty object if no provider-relevant fields are present", () => {
    expect(payloadToIssueUpdate({ priority: 2 })).toEqual({});
    expect(payloadToIssueUpdate({})).toEqual({});
  });
});

describe("payloadToIssueUpdate with an emptied diff", () => {
  /**
   * @target payloadToIssueUpdate
   * @dependencies none
   * @scenario A staged addition and removal cancelled each other out
   * @expectedOutput No field, so `Object.keys(update).length` is zero. Keeping
   *                 `{ add: [], remove: [] }` made a push with nothing to send
   *                 still call the provider, and the batch preview could not tell
   *                 a real diff from an emptied one.
   */
  it("drops a label pair whose both sides are empty", () => {
    expect(payloadToIssueUpdate({ labels: { add: [], remove: [] } })).toEqual({});
  });

  it("drops an assignee pair whose both sides are empty", () => {
    expect(payloadToIssueUpdate({ assignees: { add: [], remove: [] } })).toEqual({});
  });

  it("keeps a pair with a value on either side", () => {
    expect(payloadToIssueUpdate({ labels: { add: ["bug"], remove: [] } })).toEqual({
      labels: { add: ["bug"], remove: [] },
    });
    expect(payloadToIssueUpdate({ labels: { add: [], remove: ["bug"] } })).toEqual({
      labels: { add: [], remove: ["bug"] },
    });
  });
});
