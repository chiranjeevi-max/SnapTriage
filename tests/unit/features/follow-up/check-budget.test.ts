/**
 * @module tests/unit/features/follow-up/check-budget
 *
 * What one check pass costs the provider.
 *
 * The pass exists to answer "did anything happen" for up to twenty issues, and
 * the cheapest honest way to do that is one comment read per issue plus the
 * per-provider values read once. These tests pin the second half: the token and
 * the identity are per user and per provider, so reading them inside the loop
 * would multiply a `GET /user` by the number of followed issues.
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
const mockResolveIdentity = vi.mocked(resolveIdentity);

let provider: IssueProvider;

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  fakeDb.state.rows.repo.push(repoRow());
  fakeDb.state.rows.issue.push(issueRow());
  fakeDb.state.rows.issue.push(issueRow({ id: OTHER_ISSUE_ID, number: 8, title: "Second" }));

  // Two followed issues on the same repository and provider.
  fakeDb.state.rows.follow_up.push(followUpRow({ checkedAt: null }));
  fakeDb.state.rows.follow_up.push(
    followUpRow({ id: "follow-2", issueId: OTHER_ISSUE_ID, checkedAt: null })
  );

  provider = {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    fetchComments: vi.fn().mockResolvedValue({ comments: [], olderCursor: null }),
  } satisfies IssueProvider;

  mockGetProvider.mockReturnValue(provider);
  mockGetProviderToken.mockResolvedValue("token-abc");
  mockResolveIdentity.mockResolvedValue({ login: "me", avatar: null });
});

describe("runFollowUpCheck provider budget", () => {
  /**
   * @target runFollowUpCheck
   * @dependencies getProviderToken, resolveIdentity
   * @scenario Two followed issues on the same repository and provider
   * @expectedOutput The token and identity are read once for the pass, not once
   *                 per issue: both are per-provider values and repeating them
   *                 multiplies a provider round trip by the queue length
   */
  it("should read the token and identity once for two issues on one provider", async () => {
    const summary = await runFollowUpCheck("user-1");

    expect(summary.checked).toBe(2);
    expect(mockGetProviderToken).toHaveBeenCalledTimes(1);
    expect(mockResolveIdentity).toHaveBeenCalledTimes(1);
  });

  /**
   * @target runFollowUpCheck
   * @dependencies fetchComments
   * @scenario Two followed issues
   * @expectedOutput One comment read per issue: the per-issue work is still
   *                 per-issue, and only the shared values were hoisted
   */
  it("should still read each issue's comments separately", async () => {
    await runFollowUpCheck("user-1");

    expect(provider.fetchComments).toHaveBeenCalledTimes(2);
  });

  /**
   * @target runFollowUpCheck
   * @dependencies resolveIdentity, passContextFor
   * @scenario Reading the provider login fails on the first issue
   * @expectedOutput That issue is skipped and the pass continues; the failure is
   *                 not memoised for the rest of the pass either, so the second
   *                 issue tries again. Letting it escape would abandon every
   *                 follow-up after the first.
   */
  it("should keep checking after a failed identity lookup", async () => {
    mockResolveIdentity
      .mockRejectedValueOnce(new Error("provider is down"))
      .mockResolvedValue({ login: "me", avatar: null });

    const summary = await runFollowUpCheck("user-1");

    expect(summary.skipped).toBe(1);
    expect(summary.checked).toBe(1);
    expect(mockResolveIdentity).toHaveBeenCalledTimes(2);
  });

  /**
   * @target runFollowUpCheck
   * @dependencies getProviderToken
   * @scenario No provider token for the account
   * @expectedOutput Nothing is checked and no comment read is attempted, rather
   *                 than twenty failures. Each row still records its turn:
   *                 without that the same rows are selected first on every pass
   *                 and the queue behind them is never reached, so a token that
   *                 cannot be decrypted silently disables follow-up for good.
   */
  it("should skip the pass without a token", async () => {
    mockGetProviderToken.mockResolvedValue(null);

    const summary = await runFollowUpCheck("user-1");

    expect(summary.checked).toBe(0);
    expect(provider.fetchComments).not.toHaveBeenCalled();
    expect(fakeDb.state.rows.follow_up.map((row) => row.attemptedAt)).toEqual([
      expect.any(Date),
      expect.any(Date),
    ]);
  });

  /**
   * @target runFollowUpCheck
   * @dependencies resolveIdentity
   * @scenario The identity cannot be resolved, so the caller cannot tell its own
   *           comments apart
   * @expectedOutput The pass still runs: a missing identity widens what counts as
   *                 news rather than failing the check silently
   */
  it("should still check when the identity cannot be resolved", async () => {
    mockResolveIdentity.mockResolvedValue(null);

    const summary = await runFollowUpCheck("user-1");

    expect(summary.checked).toBe(2);
  });
});
