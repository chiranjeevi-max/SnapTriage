/**
 * @module tests/unit/features/follow-up/no-token-rotation
 *
 * A pass that cannot read a token can still finish its turn. Without that, the
 * twenty rows it selects are selected again on the next pass, and every row
 * behind them waits forever — a dead token disables follow-up entirely rather
 * than delaying it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { runFollowUpCheck } from "@/features/follow-up/follow-up-service";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import { resolveIdentity } from "@/features/replies/reply-service";
import type { IssueProvider } from "@/lib/provider-interface";
import { OTHER_ISSUE_ID, fakeDb, followUpRow, issueRow, repoRow } from "../../support/fake-db";

vi.mock("@/features/auth/get-provider-token", () => ({ getProviderToken: vi.fn() }));
vi.mock("@/lib/providers", () => ({ getProvider: vi.fn() }));
vi.mock("@/features/replies/reply-service", () => ({ resolveIdentity: vi.fn() }));
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

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  fakeDb.state.rows.repo.push(repoRow());
  fakeDb.state.rows.issue.push(issueRow());
  fakeDb.state.rows.issue.push(issueRow({ id: OTHER_ISSUE_ID, number: 8, title: "Second" }));
  fakeDb.state.rows.follow_up.push(followUpRow({ checkedAt: null }));
  fakeDb.state.rows.follow_up.push(
    followUpRow({ id: "follow-2", issueId: OTHER_ISSUE_ID, checkedAt: null })
  );

  const provider = {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    fetchComments: vi.fn().mockResolvedValue({ comments: [], olderCursor: null }),
  } satisfies IssueProvider;

  mockGetProvider.mockReturnValue(provider);
  vi.mocked(resolveIdentity).mockResolvedValue({ login: "me", avatar: null });
});

describe("a pass with no token", () => {
  /**
   * @target runFollowUpCheck
   * @dependencies getProviderToken, markAttempted
   * @scenario The token cannot be read, so nothing can be examined
   * @expectedOutput Every selected row records its attempt. The next pass then
   *                 sorts those rows behind the ones that have not had a turn
   *                 instead of picking the same twenty again.
   */
  it("records the turn for every row it could not check", async () => {
    mockGetProviderToken.mockResolvedValue(null);

    await runFollowUpCheck("user-1");

    expect(fakeDb.state.rows.follow_up.every((row) => row.attemptedAt instanceof Date)).toBe(true);
    // The baseline is untouched: an attempt that read nothing must not move it.
    expect(fakeDb.state.rows.follow_up.map((row) => row.checkedAt)).toEqual([null, null]);
  });

  /**
   * @target runFollowUpCheck's cooldown filter
   * @dependencies markAttempted
   * @scenario A second pass runs immediately after a token-less one
   * @expectedOutput Nothing is selected, because every row was just attempted.
   *                 Without the recorded attempt the same rows are examined on
   *                 every pass forever.
   */
  it("does not re-select the same rows on the next pass", async () => {
    mockGetProviderToken.mockResolvedValue(null);

    await runFollowUpCheck("user-1");
    const second = await runFollowUpCheck("user-1");

    expect(second.checked).toBe(0);
    expect(second.skipped).toBe(0);
  });

  /**
   * @target runFollowUpCheck
   * @dependencies getProviderToken, fetchComments
   * @scenario A token becomes available again after a token-less pass
   * @expectedOutput The rows are still waiting and are checked once the cooldown
   *                 lapses, so skipping was a delay and not a loss.
   */
  it("checks the rows once a token is available again", async () => {
    mockGetProviderToken.mockResolvedValue(null);
    await runFollowUpCheck("user-1");

    // Move the recorded attempts outside the cooldown.
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    for (const row of fakeDb.state.rows.follow_up) row.attemptedAt = longAgo;

    mockGetProviderToken.mockResolvedValue("token-abc");
    const summary = await runFollowUpCheck("user-1");

    expect(summary.checked).toBe(2);
  });
});
