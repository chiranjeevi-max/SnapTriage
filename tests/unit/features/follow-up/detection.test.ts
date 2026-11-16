/**
 * @module tests/unit/features/follow-up/detection
 *
 * The follow-up check decides when to interrupt the user, so a false positive
 * costs more than a miss. These tests pin every exclusion rule and the two
 * comparisons that are easy to get subtly wrong: comment ids of unequal width,
 * and timestamps that tie inside one burst.
 */
import { describe, expect, it } from "vitest";
import {
  compareCommentIds,
  describeFollowUpReason,
  detectFollowUp,
  isBotLogin,
  newestComment,
  type FollowUpBaseline,
} from "@/features/follow-up/detection";
import type { ProviderComment } from "@/lib/provider-interface";

/** A comment, defaulting to a human reply after any baseline. */
function comment(overrides: Partial<ProviderComment> = {}): ProviderComment {
  return {
    id: "100",
    body: "Any update on this?",
    author: "nadia",
    authorAvatar: null,
    createdAt: new Date("2026-03-02T10:00:00Z"),
    updatedAt: new Date("2026-03-02T10:00:00Z"),
    isSystem: false,
    url: null,
    ...overrides,
  };
}

/** A baseline taken before {@link comment}'s default instant. */
function baseline(overrides: Partial<FollowUpBaseline> = {}): FollowUpBaseline {
  return {
    lastSeenCommentId: "90",
    lastSeenCommentAt: new Date("2026-03-01T00:00:00Z"),
    stateAtBaseline: "open",
    reviewedCommentId: null,
    ...overrides,
  };
}

const OPEN = { selfLogin: "me", state: "open" as const };
const CLOSED = { selfLogin: "me", state: "closed" as const };

describe("compareCommentIds", () => {
  it("orders by numeric width before lexically", () => {
    expect(compareCommentIds("9", "10")).toBeLessThan(0);
    expect(compareCommentIds("100", "99")).toBeGreaterThan(0);
  });

  it("compares ids past the safe integer range exactly", () => {
    // These both round to the same double, so a Number() comparison would call them equal.
    expect(compareCommentIds("9007199254740993", "9007199254740992")).toBeGreaterThan(0);
    expect(compareCommentIds("9007199254740992", "9007199254740993")).toBeLessThan(0);
  });

  it("treats equal ids as equal", () => {
    expect(compareCommentIds("12345", "12345")).toBe(0);
  });

  it("ignores leading zeroes", () => {
    expect(compareCommentIds("007", "7")).toBe(0);
  });
});

describe("isBotLogin", () => {
  it("recognises the conventional automation suffixes", () => {
    expect(isBotLogin("dependabot[bot]")).toBe(true);
    expect(isBotLogin("renovate-bot")).toBe(true);
    expect(isBotLogin("github-actions_bot")).toBe(true);
    expect(isBotLogin("DEPENDABOT[BOT]")).toBe(true);
  });

  it("does not mistake a human login for a bot", () => {
    expect(isBotLogin("nadia")).toBe(false);
    expect(isBotLogin("abbott")).toBe(false);
    expect(isBotLogin("bartholomew")).toBe(false);
    expect(isBotLogin("talbot")).toBe(false);
    expect(isBotLogin(null)).toBe(false);
  });
});

describe("detectFollowUp", () => {
  it("qualifies a human reply after the baseline", () => {
    const check = detectFollowUp(baseline(), [comment()], OPEN);

    expect(check.qualifies).toBe(true);
    expect(check.reason).toBe("reply");
    expect(check.trigger?.id).toBe("100");
  });

  it("ignores your own comment", () => {
    const check = detectFollowUp(baseline(), [comment({ author: "me" })], OPEN);

    expect(check.qualifies).toBe(false);
  });

  it("compares your own login case-insensitively", () => {
    const check = detectFollowUp(baseline(), [comment({ author: "Me" })], {
      selfLogin: "ME",
      state: "open",
    });

    expect(check.qualifies).toBe(false);
  });

  it("ignores a bot", () => {
    const check = detectFollowUp(baseline(), [comment({ author: "dependabot[bot]" })], OPEN);

    expect(check.qualifies).toBe(false);
  });

  it("ignores a system record", () => {
    const check = detectFollowUp(baseline(), [comment({ isSystem: true, author: "nadia" })], OPEN);

    expect(check.qualifies).toBe(false);
  });

  it("ignores a comment that predates the baseline", () => {
    const check = detectFollowUp(
      baseline(),
      [comment({ id: "80", createdAt: new Date("2026-02-01T00:00:00Z") })],
      OPEN
    );

    expect(check.qualifies).toBe(false);
  });

  it("requires both the id and the instant to be newer", () => {
    // A newer timestamp with an older id is a re-import, not a reply.
    const check = detectFollowUp(
      baseline(),
      [comment({ id: "80", createdAt: new Date("2026-04-01T00:00:00Z") })],
      OPEN
    );

    expect(check.qualifies).toBe(false);
  });

  it("qualifies when a burst shares the baseline instant but has a newer id", () => {
    const instant = new Date("2026-03-01T00:00:00Z");
    const check = detectFollowUp(
      baseline({ lastSeenCommentAt: instant, lastSeenCommentId: "90" }),
      [comment({ id: "91", createdAt: instant })],
      OPEN
    );

    expect(check.qualifies).toBe(false);
    expect(check.reason).toBeNull();
  });

  it("does not raise the comment whose review dismissed it", () => {
    const check = detectFollowUp(
      baseline({ reviewedCommentId: "100" }),
      [comment({ id: "100" })],
      OPEN
    );

    expect(check.qualifies).toBe(false);
  });

  it("raises a newer comment even after an earlier one was reviewed", () => {
    const check = detectFollowUp(
      baseline({ reviewedCommentId: "100" }),
      [comment({ id: "100" }), comment({ id: "101", createdAt: new Date("2026-03-05T00:00:00Z") })],
      OPEN
    );

    expect(check.qualifies).toBe(true);
    expect(check.trigger?.id).toBe("101");
  });

  it("reports the first qualifying comment, not the newest", () => {
    const check = detectFollowUp(
      baseline(),
      [comment({ id: "100" }), comment({ id: "200", createdAt: new Date("2026-03-09T00:00:00Z") })],
      OPEN
    );

    expect(check.trigger?.id).toBe("100");
  });

  it("qualifies a reopen of an issue that was closed when waiting was armed", () => {
    const check = detectFollowUp(baseline({ stateAtBaseline: "closed" }), [], OPEN);

    expect(check.qualifies).toBe(true);
    expect(check.reason).toBe("reopened");
    expect(check.trigger).toBeNull();
  });

  it("does not treat an already-open issue as reopened", () => {
    const check = detectFollowUp(baseline({ stateAtBaseline: "open" }), [], OPEN);

    expect(check.qualifies).toBe(false);
  });

  it("does not qualify an issue that is still closed", () => {
    const check = detectFollowUp(baseline({ stateAtBaseline: "closed" }), [], CLOSED);

    expect(check.qualifies).toBe(false);
  });

  it("still finds a reply on a closed issue", () => {
    const check = detectFollowUp(baseline(), [comment()], CLOSED);

    expect(check.qualifies).toBe(true);
    expect(check.reason).toBe("reply");
  });

  it("qualifies the first comment when no baseline comment was recorded", () => {
    const check = detectFollowUp(
      baseline({ lastSeenCommentId: null, lastSeenCommentAt: null }),
      [comment()],
      OPEN
    );

    expect(check.qualifies).toBe(true);
  });

  it("works when the user's own login is unknown", () => {
    const check = detectFollowUp(baseline(), [comment({ author: "anybody" })], {
      selfLogin: null,
      state: "open",
    });

    expect(check.qualifies).toBe(true);
  });

  it("qualifies nothing for an empty page", () => {
    const check = detectFollowUp(baseline(), [], OPEN);

    expect(check.qualifies).toBe(false);
    expect(check.reason).toBeNull();
  });
});

describe("newestComment", () => {
  it("returns the highest id rather than the last element", () => {
    const newest = newestComment([comment({ id: "900" }), comment({ id: "1000" })]);

    expect(newest?.id).toBe("1000");
  });

  it("returns null for an empty page", () => {
    expect(newestComment([])).toBeNull();
  });
});

describe("describeFollowUpReason", () => {
  it("names each reason", () => {
    expect(describeFollowUpReason("reply")).toBe("Replied");
    expect(describeFollowUpReason("reopened")).toBe("Reopened");
    expect(describeFollowUpReason(null)).toBe("Waiting");
  });
});
