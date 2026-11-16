/**
 * @module tests/unit/features/follow-up/follow-up-service
 *
 * Arming, reviewing, and checking a follow-up — the database half of the
 * follow-up inbox. `detection.ts` is tested separately and is not repeated here;
 * what these tests pin is what the service does with a verdict.
 *
 * Three of them are regression guards for behaviours that look like small
 * details and are not:
 *
 * - **Review moves the baseline.** If `reviewFollowUp` only flipped `state`, the
 *   same comment would raise the issue again on the next pass, forever.
 * - **A check never moves the baseline.** If it did, an unread resurface would
 *   silently retract the next time the inbox was opened, and the item would be
 *   lost without the user ever seeing it.
 * - **A failed check leaves `checkedAt` alone.** Advancing it on failure would
 *   claim a freshness the pass does not have.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  armFollowUp,
  followUpStatesFor,
  listFollowUps,
  reviewFollowUp,
  runFollowUpCheck,
  stopFollowUp,
} from "@/features/follow-up/follow-up-service";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import type { IssueProvider, ProviderComment } from "@/lib/provider-interface";
import {
  ISSUE_ID,
  OTHER_ISSUE_ID,
  OTHER_REPO_ID,
  fakeDb,
  followUpRow,
  issueRow,
  providerIdentityRow,
  repoRow,
} from "../../support/fake-db";

vi.mock("@/features/auth/get-provider-token", () => ({ getProviderToken: vi.fn() }));
vi.mock("@/lib/providers", () => ({ getProvider: vi.fn() }));
vi.mock("@/lib/db/query", async () => {
  const { fakeDb } = await import("../../support/fake-db");
  return { typedDb: fakeDb.typedDb };
});
vi.mock("@/lib/logger", () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  providerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetProviderToken = vi.mocked(getProviderToken);
const mockGetProvider = vi.mocked(getProvider);

/** A comment from the reporter, newer than {@link followUpRow}'s baseline. */
function comment(overrides: Partial<ProviderComment> = {}): ProviderComment {
  return {
    id: "100",
    body: "Any update on this?",
    author: "nadia",
    authorAvatar: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    isSystem: false,
    url: null,
    ...overrides,
  };
}

/**
 * A provider whose comment reads are configurable per test.
 *
 * `fetchComments` answers with the given page; the rest exist so the stub still
 * satisfies the interface.
 */
function providerStub(page: { comments: ProviderComment[]; olderCursor: string | null }) {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    fetchComments: vi.fn().mockResolvedValue(page),
    createComment: vi.fn(),
    getAuthenticatedUser: vi.fn().mockResolvedValue({ login: "me", avatar: null }),
  } satisfies IssueProvider;
}

/** Seed the default repo, issue, and a cached identity for `user-1`. */
function seedRepoAndIssue(): void {
  fakeDb.state.rows.repo.push(repoRow());
  fakeDb.state.rows.issue.push(issueRow());
  fakeDb.state.rows.provider_identity.push(providerIdentityRow({ login: "me" }));
}

let provider: ReturnType<typeof providerStub>;

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  provider = providerStub({ comments: [], olderCursor: null });
  mockGetProvider.mockReturnValue(provider);
  mockGetProviderToken.mockResolvedValue("token-abc");
});

describe("armFollowUp", () => {
  /**
   * @target armFollowUp
   * @dependencies provider.fetchComments, newestComment
   * @scenario The issue's newest comment is readable when the user chooses to wait
   * @expectedOutput The row records that comment as the baseline, so only later
   *                 activity can raise the issue
   */
  it("should record the newest comment as the baseline", async () => {
    seedRepoAndIssue();
    provider.fetchComments.mockResolvedValue({
      comments: [comment({ id: "900" }), comment({ id: "1000" })],
      olderCursor: null,
    });

    const entry = await armFollowUp("user-1", ISSUE_ID);

    expect(entry?.state).toBe("waiting");
    expect(entry?.due).toBe(false);
    expect(fakeDb.state.rows.follow_up[0].lastSeenCommentId).toBe("1000");
    expect(fakeDb.state.rows.follow_up[0].lastSeenCommentAt).toEqual(
      new Date("2026-02-01T00:00:00.000Z")
    );
    expect(fakeDb.state.rows.follow_up[0].stateAtBaseline).toBe("open");
  });

  /**
   * @target armFollowUp
   * @dependencies readBaseline
   * @scenario The provider fails while the baseline is being read
   * @expectedOutput The follow-up is still armed, with a null baseline: erring
   *                 towards an extra resurface beats missing a reply
   */
  it("should still arm with a null baseline when the provider fails", async () => {
    seedRepoAndIssue();
    provider.fetchComments.mockRejectedValue(new Error("provider is down"));

    const entry = await armFollowUp("user-1", ISSUE_ID);

    expect(entry?.state).toBe("waiting");
    expect(fakeDb.state.rows.follow_up).toHaveLength(1);
    expect(fakeDb.state.rows.follow_up[0].lastSeenCommentId).toBeNull();
    expect(fakeDb.state.rows.follow_up[0].lastSeenCommentAt).toBeNull();
  });

  /**
   * @target armFollowUp
   * @dependencies typedDb.onConflictDoUpdate
   * @scenario A previously reviewed follow-up is armed again
   * @expectedOutput One row, reset to `waiting` with a fresh baseline: re-arming
   *                 is a new watch, not a resurrection of the old one
   */
  it("should reset a reviewed follow-up to waiting", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.follow_up.push(
      followUpRow({
        state: "reviewed",
        reviewedCommentId: "100",
        reason: "reply",
        lastSeenCommentId: "100",
      })
    );
    provider.fetchComments.mockResolvedValue({
      comments: [comment({ id: "1200" })],
      olderCursor: null,
    });

    const entry = await armFollowUp("user-1", ISSUE_ID);

    expect(entry?.state).toBe("waiting");
    expect(fakeDb.state.rows.follow_up).toHaveLength(1);
    expect(fakeDb.state.rows.follow_up[0].state).toBe("waiting");
    expect(fakeDb.state.rows.follow_up[0].reason).toBeNull();
    expect(fakeDb.state.rows.follow_up[0].reviewedCommentId).toBeNull();
    expect(fakeDb.state.rows.follow_up[0].lastSeenCommentId).toBe("1200");
  });

  /**
   * @target armFollowUp
   * @dependencies loadWaitingIssue
   * @scenario The issue belongs to another user's repository
   * @expectedOutput `null` and nothing written: the ownership join is the only
   *                 thing that keeps a guessed id from arming a watch
   */
  it("should return null for another user's issue", async () => {
    fakeDb.state.rows.repo.push(repoRow({ userId: "user-2" }));
    fakeDb.state.rows.issue.push(issueRow());

    const entry = await armFollowUp("user-1", ISSUE_ID);

    expect(entry).toBeNull();
    expect(fakeDb.state.rows.follow_up).toHaveLength(0);
  });
});

describe("reviewFollowUp", () => {
  /**
   * @target reviewFollowUp
   * @dependencies typedDb.update(follow_up)
   * @scenario The user acknowledges the comment that raised the issue
   * @expectedOutput `state: reviewed`, `reason: null`, and the baseline moved to
   *                 the reviewed comment's id and instant
   */
  it("should mark the follow-up reviewed and move the baseline", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ state: "waiting", reason: "reply" }));
    const reviewedAt = new Date("2026-02-02T09:00:00.000Z");

    const reviewed = await reviewFollowUp("user-1", ISSUE_ID, "100", reviewedAt);

    expect(reviewed).toBe(true);
    const stored = fakeDb.state.rows.follow_up[0];
    expect(stored.state).toBe("reviewed");
    expect(stored.reason).toBeNull();
    expect(stored.reviewedCommentId).toBe("100");
    expect(stored.lastSeenCommentId).toBe("100");
    expect(stored.lastSeenCommentAt).toEqual(reviewedAt);
  });

  /**
   * @target reviewFollowUp
   * @dependencies detectFollowUp, runFollowUpCheck
   * @scenario The reviewed comment is the newest one, and the issue is checked
   *           again after the cooldown has passed
   * @expectedOutput Nothing re-raises: without the baseline move the same comment
   *                 would surface forever
   */
  it("should not let the reviewed comment raise the issue again", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.follow_up.push(followUpRow({ state: "waiting", checkedAt: null }));
    const reviewedAt = new Date("2026-02-01T00:00:00.000Z");
    provider.fetchComments.mockResolvedValue({
      comments: [comment({ id: "100", createdAt: reviewedAt })],
      olderCursor: null,
    });

    await reviewFollowUp("user-1", ISSUE_ID, "100", reviewedAt);
    // Review just stamped `checkedAt`, so the pass would skip the row for a
    // reason unrelated to the baseline. Expire the cooldown to isolate it.
    fakeDb.state.rows.follow_up[0].checkedAt = new Date("2026-01-01T00:00:00.000Z");
    fakeDb.state.rows.follow_up[0].state = "waiting";

    const summary = await runFollowUpCheck("user-1");

    expect(summary).toEqual({ checked: 1, surfaced: 0, skipped: 0 });
    expect(fakeDb.state.rows.follow_up[0].reason).toBeNull();
  });

  /**
   * @target reviewFollowUp
   * @dependencies detectFollowUp, runFollowUpCheck
   * @scenario The review comes from the queue, which knows the reason but not the
   *           comment that produced it, so no comment id or instant is supplied
   * @expectedOutput The baseline still moves — to the review instant — and the
   *                 comment that raised the issue does not raise it again. A
   *                 review that changed nothing would be a broken control.
   */
  it("should stop a re-raise when the review does not name the comment", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.follow_up.push(followUpRow({ state: "waiting", checkedAt: null }));
    // Strictly in the past, so the review instant is later than it.
    const raisedAt = new Date("2026-02-01T00:00:00.000Z");
    provider.fetchComments.mockResolvedValue({
      comments: [comment({ id: "100", createdAt: raisedAt })],
      olderCursor: null,
    });

    await reviewFollowUp("user-1", ISSUE_ID, null, null);
    fakeDb.state.rows.follow_up[0].checkedAt = new Date("2026-01-01T00:00:00.000Z");
    fakeDb.state.rows.follow_up[0].state = "waiting";

    const summary = await runFollowUpCheck("user-1");

    expect(summary.surfaced).toBe(0);
    expect(fakeDb.state.rows.follow_up[0].reason).toBeNull();
  });

  /**
   * @target reviewFollowUp
   * @dependencies typedDb.update(follow_up)
   * @scenario Nothing is being followed on the issue
   * @expectedOutput `false` and no row created
   */
  it("should report false when the issue is not followed", async () => {
    const reviewed = await reviewFollowUp("user-1", ISSUE_ID, "100", new Date());

    expect(reviewed).toBe(false);
    expect(fakeDb.state.rows.follow_up).toHaveLength(0);
  });
});

describe("stopFollowUp", () => {
  /**
   * @target stopFollowUp
   * @dependencies typedDb.update(follow_up)
   * @scenario The user abandons tracking without acknowledging the activity
   * @expectedOutput `state: stopped` and the reason cleared, so the queue stops
   *                 presenting it as news
   */
  it("should mark the follow-up stopped and clear the reason", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ state: "waiting", reason: "reply" }));

    const stopped = await stopFollowUp("user-1", ISSUE_ID);

    expect(stopped).toBe(true);
    expect(fakeDb.state.rows.follow_up[0].state).toBe("stopped");
    expect(fakeDb.state.rows.follow_up[0].reason).toBeNull();
  });

  /**
   * @target stopFollowUp
   * @dependencies typedDb.update(follow_up)
   * @scenario The row belongs to another user
   * @expectedOutput `false` and the row is left waiting
   */
  it("should not stop another user's follow-up", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ userId: "user-2" }));

    expect(await stopFollowUp("user-1", ISSUE_ID)).toBe(false);
    expect(fakeDb.state.rows.follow_up[0].state).toBe("waiting");
  });
});

describe("runFollowUpCheck", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * @target runFollowUpCheck
   * @dependencies RECHECK_COOLDOWN_MS
   * @scenario The row was checked five seconds ago
   * @expectedOutput Nothing examined, counted as skipped, and no provider call:
   *                 opening the inbox twice must not double the traffic
   */
  it("should skip a row still inside the cooldown", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.follow_up.push(followUpRow({ checkedAt: new Date(Date.now() - 5_000) }));

    const summary = await runFollowUpCheck("user-1");

    expect(summary).toEqual({ checked: 0, surfaced: 0, skipped: 1 });
    expect(provider.fetchComments).not.toHaveBeenCalled();
  });

  /**
   * @target runFollowUpCheck
   * @dependencies checkOne, detectFollowUp
   * @scenario A qualifying reply landed after the baseline
   * @expectedOutput The reason is stored and `lastSeenCommentId` is NOT advanced,
   *                 because advancing it would retract an unread resurface
   */
  it("should store the reason without advancing the baseline", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.follow_up.push(followUpRow({ checkedAt: null }));
    provider.fetchComments.mockResolvedValue({
      comments: [comment({ id: "100" })],
      olderCursor: null,
    });

    const summary = await runFollowUpCheck("user-1");

    expect(summary).toEqual({ checked: 1, surfaced: 1, skipped: 0 });
    const stored = fakeDb.state.rows.follow_up[0];
    expect(stored.reason).toBe("reply");
    expect(stored.lastSeenCommentId).toBe("90");
    expect(stored.checkedAt).toBeInstanceOf(Date);
  });

  /**
   * @target runFollowUpCheck
   * @dependencies checkOne
   * @scenario Nothing qualifying has landed
   * @expectedOutput `checkedAt` advances and no reason is stored
   */
  it("should record the check time when nothing qualifies", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.follow_up.push(followUpRow({ checkedAt: null }));

    const summary = await runFollowUpCheck("user-1");

    expect(summary).toEqual({ checked: 1, surfaced: 0, skipped: 0 });
    expect(fakeDb.state.rows.follow_up[0].reason).toBeNull();
    expect(fakeDb.state.rows.follow_up[0].checkedAt).toBeInstanceOf(Date);
  });

  /**
   * @target runFollowUpCheck
   * @dependencies checkOne, providerLogger
   * @scenario One issue's provider read fails while another succeeds
   * @expectedOutput The failure keeps its old `checkedAt` and is counted as
   *                 skipped, and the rest of the pass still runs
   */
  it("should leave a failed issue's check time untouched and continue the pass", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.issue.push(
      issueRow({ id: OTHER_ISSUE_ID, number: 8, providerIssueId: "gh-8" })
    );
    const oldCheck = new Date("2026-01-01T00:00:00.000Z");
    fakeDb.state.rows.follow_up.push(
      followUpRow({ id: "follow-up-a", issueId: ISSUE_ID, checkedAt: oldCheck }),
      followUpRow({
        id: "follow-up-b",
        issueId: OTHER_ISSUE_ID,
        checkedAt: null,
        updatedAt: new Date("2026-01-08T00:00:00.000Z"),
      })
    );
    provider.fetchComments
      .mockRejectedValueOnce(new Error("provider is down"))
      .mockResolvedValueOnce({ comments: [comment({ id: "100" })], olderCursor: null });

    const summary = await runFollowUpCheck("user-1");

    expect(summary).toEqual({ checked: 1, surfaced: 1, skipped: 1 });
    expect(fakeDb.state.rows.follow_up[0].checkedAt).toEqual(oldCheck);
    expect(fakeDb.state.rows.follow_up[0].reason).toBeNull();
    expect(fakeDb.state.rows.follow_up[1].reason).toBe("reply");
  });

  /**
   * @target runFollowUpCheck
   * @dependencies MAX_CHECKS_PER_PASS
   * @scenario The user waits on 25 issues
   * @expectedOutput Only 20 are examined: the pass is bounded so opening the
   *                 inbox cannot become an unbounded fan-out
   */
  it("should examine at most twenty issues per pass", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    for (let index = 0; index < 25; index++) {
      const issueId = `issue-${index}`;
      fakeDb.state.rows.issue.push(
        issueRow({ id: issueId, number: index + 1, providerIssueId: `gh-${index}` })
      );
      fakeDb.state.rows.follow_up.push(followUpRow({ id: `follow-up-${index}`, issueId }));
    }

    const summary = await runFollowUpCheck("user-1");

    expect(provider.fetchComments).toHaveBeenCalledTimes(20);
    expect(summary.checked).toBe(20);
  });

  /**
   * @target runFollowUpCheck
   * @dependencies typedDb.select(follow_up)
   * @scenario Another user has waiting follow-ups of their own
   * @expectedOutput Only the caller's issues are examined
   */
  it("should check only the caller's follow-ups", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.repo.push(repoRow({ id: OTHER_REPO_ID, userId: "user-2" }));
    fakeDb.state.rows.issue.push(issueRow({ id: OTHER_ISSUE_ID, repoId: OTHER_REPO_ID }));
    fakeDb.state.rows.follow_up.push(followUpRow({ userId: "user-2", issueId: OTHER_ISSUE_ID }));

    const summary = await runFollowUpCheck("user-1");

    expect(summary).toEqual({ checked: 0, surfaced: 0, skipped: 0 });
    expect(provider.fetchComments).not.toHaveBeenCalled();
  });
});

describe("listFollowUps", () => {
  /**
   * @target listFollowUps
   * @dependencies typedDb.innerJoin
   * @scenario A waiting issue with a reason stored
   * @expectedOutput The display fields are joined in and `due` is true
   */
  it("should return a joined entry marked due when waiting with a reason", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.follow_up.push(followUpRow({ reason: "reply" }));

    const entries = await listFollowUps("user-1");

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      issueId: ISSUE_ID,
      number: 7,
      title: "Crash on start",
      provider: "github",
      fullName: "octo/repo",
      state: "waiting",
      reason: "reply",
      due: true,
    });
  });

  /**
   * @target listFollowUps
   * @dependencies typedDb.innerJoin
   * @scenario A reviewed issue that still carries a stale reason in the row
   * @expectedOutput `due` is false: only `waiting` can be due, so a reviewed
   *                 issue is never re-announced as news
   */
  it("should not mark a reviewed entry due even when a reason is stored", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.follow_up.push(followUpRow({ state: "reviewed", reason: "reply" }));

    const entries = await listFollowUps("user-1");

    expect(entries[0].state).toBe("reviewed");
    expect(entries[0].due).toBe(false);
  });

  /**
   * @target listFollowUps
   * @dependencies typedDb.innerJoin
   * @scenario Another user follows the same issue
   * @expectedOutput Empty: the row's `userId` and the repo's `userId` both scope it
   */
  it("should not list another user's follow-ups", async () => {
    seedRepoAndIssue();
    fakeDb.state.rows.follow_up.push(followUpRow({ userId: "user-2" }));

    expect(await listFollowUps("user-1")).toEqual([]);
  });
});

describe("followUpStatesFor", () => {
  /**
   * @target followUpStatesFor
   * @dependencies inArray
   * @scenario The caller asks about two issues, one of which is followed
   * @expectedOutput A map holding only the followed issue's state
   */
  it("should map the requested issues to their follow-up state", async () => {
    fakeDb.state.rows.follow_up.push(
      followUpRow({ issueId: ISSUE_ID, state: "waiting" }),
      followUpRow({ id: "follow-up-other", issueId: "issue-not-asked-about" })
    );

    const states = await followUpStatesFor("user-1", [ISSUE_ID, OTHER_ISSUE_ID]);

    expect(states.size).toBe(1);
    expect(states.get(ISSUE_ID)).toBe("waiting");
  });

  /**
   * @target followUpStatesFor
   * @dependencies typedDb.select
   * @scenario No issue ids are supplied
   * @expectedOutput An empty map with no query issued, which is what keeps the
   *                 queue overlay from emitting `in ()`
   */
  it("should answer an empty map without querying for no ids", async () => {
    const states = await followUpStatesFor("user-1", []);

    expect(states.size).toBe(0);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target followUpStatesFor
   * @dependencies inArray
   * @scenario The followed issue belongs to another user
   * @expectedOutput An empty map
   */
  it("should not report another user's follow-up state", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ userId: "user-2" }));

    expect((await followUpStatesFor("user-1", [ISSUE_ID])).size).toBe(0);
  });
});
