/**
 * @module tests/unit/features/replies/claim-race
 *
 * The duplicate-send guarantee under concurrency.
 *
 * The sequential tests prove that a second send is refused after the first has
 * recorded its attempt. They do not prove the interesting case: two senders that
 * both start before either has recorded anything. That is the race the claim
 * exists to close, and it is invisible to a test that awaits one call before
 * starting the next.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { sendReply, type ReplyTarget } from "@/features/replies/reply-service";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import type { IssueProvider, ProviderComment } from "@/lib/provider-interface";
import { ISSUE_ID, fakeDb, issueRow, repoRow } from "../../support/fake-db";

vi.mock("@/features/auth/get-provider-token", () => ({ getProviderToken: vi.fn() }));
vi.mock("@/lib/providers", () => ({ getProvider: vi.fn() }));
vi.mock("@/lib/db/query", async () => {
  const { fakeDb } = await import("../../support/fake-db");
  return { typedDb: fakeDb.typedDb };
});
vi.mock("@/lib/logger", () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockGetProviderToken = vi.mocked(getProviderToken);
const mockGetProvider = vi.mocked(getProvider);

const TARGET: ReplyTarget = {
  issueId: ISSUE_ID,
  repoId: "11111111-1111-4111-8111-111111111111",
  provider: "github",
  owner: "octo",
  name: "repo",
  number: 7,
  url: "https://github.com/octo/repo/issues/7",
};

/** A comment as the provider returns it after a successful post. */
function posted(): ProviderComment {
  return {
    id: "9001",
    body: "Thanks.",
    author: "me",
    authorAvatar: null,
    createdAt: new Date("2026-03-02T10:00:00Z"),
    updatedAt: new Date("2026-03-02T10:00:00Z"),
    isSystem: false,
    url: null,
  };
}

let provider: IssueProvider;

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  fakeDb.state.rows.repo.push(repoRow());
  fakeDb.state.rows.issue.push(issueRow());

  // The provider call is deliberately slow enough that both senders have
  // completed their claim before either returns, which is what makes the two
  // attempts genuinely concurrent rather than merely interleaved.
  provider = {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    createComment: vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return posted();
    }),
  } satisfies IssueProvider;

  mockGetProvider.mockReturnValue(provider);
  mockGetProviderToken.mockResolvedValue("token-abc");
});

describe("sendReply under concurrent senders", () => {
  /**
   * @target sendReply
   * @dependencies claimAttempt, typedDb.update(reply_draft)
   * @scenario Two sends start before either has recorded an attempt, as two
   *           tabs pressing Send within the same round trip would
   * @expectedOutput Exactly one reaches the provider. The other is refused with
   *                 `unconfirmed`, because the comment it would duplicate may
   *                 already exist.
   */
  it("should let only one of two simultaneous sends reach the provider", async () => {
    const [first, second] = await Promise.all([
      sendReply("user-1", TARGET, "Thanks."),
      sendReply("user-1", TARGET, "Thanks."),
    ]);

    const outcomes = [first, second];
    const published = outcomes.filter((outcome) => outcome.ok);
    const refused = outcomes.filter((outcome) => !outcome.ok);

    expect(published).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].ok === false && refused[0].status).toBe(409);
    expect(provider.createComment).toHaveBeenCalledTimes(1);
  });

  /**
   * @target sendReply
   * @dependencies claimAttempt
   * @scenario Three senders race, as a reload-happy user with two open tabs would
   * @expectedOutput Still exactly one provider call: the claim is a single
   *                 conditional statement, so its result does not depend on how
   *                 many callers arrive at once.
   */
  it("should still allow only one provider call when three race", async () => {
    const outcomes = await Promise.all([
      sendReply("user-1", TARGET, "Thanks."),
      sendReply("user-1", TARGET, "Thanks."),
      sendReply("user-1", TARGET, "Thanks."),
    ]);

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(provider.createComment).toHaveBeenCalledTimes(1);
  });

  /**
   * @target sendReply
   * @dependencies claimAttempt
   * @scenario A send follows one that has been reconciled by a definitive
   *           provider rejection
   * @expectedOutput The second send is allowed: the claim was released, so the
   *                 user is not locked out of an issue after a real failure
   */
  it("should allow a later send once a definitive rejection released the claim", async () => {
    const { ProviderApiError } = await import("@/lib/provider-error");

    vi.mocked(provider.createComment!).mockRejectedValueOnce(
      new ProviderApiError(422, "validation failed", {
        provider: "github",
        operation: "createComment",
      })
    );

    const first = await sendReply("user-1", TARGET, "Thanks.");
    expect(first.ok).toBe(false);

    // A 422 is a definitive answer, so the claim must be gone.
    const claim = fakeDb.state.rows.reply_draft[0]?.sendAttemptedAt ?? null;
    expect(claim).toBeNull();
  });
});
