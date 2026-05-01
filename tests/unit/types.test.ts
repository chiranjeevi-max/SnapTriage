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
