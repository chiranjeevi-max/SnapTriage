/**
 * @module tests/unit/features/replies/reply-service
 *
 * The send path, and the draft store it depends on.
 *
 * Two guarantees are what these tests exist for, and both are invisible in a
 * happy-path check:
 *
 * - **A body the provider would refuse never reaches it.** The length is
 *   validated against the repository's own provider limit before the token is
 *   even resolved, so GitHub's 65,536-character cap rejects a GitLab-sized body
 *   without an HTTP request.
 * - **A second send is refused while an earlier one is unresolved.** There is no
 *   idempotency key on either comment endpoint, so a timeout is indistinguishable
 *   from a request that never arrived. `sendAttemptedAt` is written *before* the
 *   provider call and cleared only on a definitive answer, which is the only
 *   thing standing between a retry and a duplicated public reply.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  clearDraft,
  findDraft,
  releaseSendClaim,
  saveDraft,
  sendReply,
  resolveIdentity,
  type DraftSaveOutcome,
  type ReplyTarget,
  type SendReplyResult,
} from "@/features/replies/reply-service";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import { ProviderApiError } from "@/lib/provider-error";
import { providerLimits, type IssueProvider, type ProviderComment } from "@/lib/provider-interface";
import {
  DRAFT_ID,
  ISSUE_ID,
  fakeDb,
  providerIdentityRow,
  replyDraftRow,
} from "../../support/fake-db";

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

/** The issue and provider coordinates `sendReply` publishes with. */
const TARGET: ReplyTarget = {
  issueId: ISSUE_ID,
  repoId: "11111111-1111-4111-8111-111111111111",
  provider: "github",
  owner: "octo",
  name: "repo",
  number: 7,
  url: "https://github.com/octo/repo/issues/7",
};

/** A comment as the provider would return it after storing it. */
function comment(overrides: Partial<ProviderComment> = {}): ProviderComment {
  return {
    id: "1001",
    body: "Thanks for the report.",
    author: "me",
    authorAvatar: null,
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
    updatedAt: new Date("2026-02-01T00:00:00.000Z"),
    isSystem: false,
    url: "https://github.com/octo/repo/issues/7#issuecomment-1001",
    ...overrides,
  };
}

/**
 * A provider whose comment support is present but only the named calls are
 * expected; each one appends to the shared operation log so ordering is
 * assertable.
 */
function providerStub() {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    fetchComments: vi.fn().mockResolvedValue({ comments: [], olderCursor: null }),
    createComment: vi.fn(async () => {
      fakeDb.state.log.push("provider:createComment");
      return comment();
    }),
    getAuthenticatedUser: vi.fn().mockResolvedValue({ login: "me", avatar: null }),
  } satisfies IssueProvider;
}

/** A provider that never implemented comments, as the interface permits. */
function providerWithoutComments(): IssueProvider {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
  };
}

/** Narrow a `sendReply` result to its failure branch, failing loudly otherwise. */
function sendFailure(result: SendReplyResult): Extract<SendReplyResult, { ok: false }> {
  if (result.ok) throw new Error("expected the send to fail");
  return result;
}

/** Narrow a `saveDraft` result to its refusal branch. */
function saveFailure(result: DraftSaveOutcome): Extract<DraftSaveOutcome, { ok: false }> {
  if (result.ok) throw new Error("expected the save to be refused");
  return result;
}

let provider: ReturnType<typeof providerStub>;

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  provider = providerStub();
  mockGetProvider.mockReturnValue(provider);
  mockGetProviderToken.mockResolvedValue("token-abc");
});

describe("saveDraft", () => {
  /**
   * @target saveDraft
   * @dependencies typedDb.insert(reply_drafts)
   * @scenario No draft exists and the editor believes it is the first write
   * @expectedOutput A draft at version 1 carrying the body
   */
  it("should create a draft at version 1 for expectedVersion 0", async () => {
    const result = await saveDraft("user-1", ISSUE_ID, "First pass", 0);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.body).toBe("First pass");
    expect(result.draft.version).toBe(1);
    expect(result.draft.sendAttemptedAt).toBeNull();
    expect(fakeDb.state.rows.reply_draft).toHaveLength(1);
  });

  /**
   * @target saveDraft
   * @dependencies typedDb.select(reply_drafts)
   * @scenario A second tab writes version 0 for a draft that already exists
   * @expectedOutput 409, and the stored body is not overwritten: the loser
   *                 reloads instead of silently replacing work
   */
  it("should refuse a second create with expectedVersion 0", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ body: "Original" }));

    const failure = saveFailure(await saveDraft("user-1", ISSUE_ID, "Overwrite", 0));

    expect(failure.status).toBe(409);
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("Original");
    expect(fakeDb.state.rows.reply_draft[0].version).toBe(1);
  });

  /**
   * @target saveDraft
   * @dependencies typedDb.update(reply_drafts)
   * @scenario The editor holds the current version
   * @expectedOutput 200-equivalent success with the version bumped to 2
   */
  it("should bump the version when the caller holds the current one", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ body: "Original", version: 1 }));

    const result = await saveDraft("user-1", ISSUE_ID, "Edited", 1);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.version).toBe(2);
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("Edited");
  });

  /**
   * @target saveDraft
   * @dependencies typedDb.update(reply_drafts)
   * @scenario Another writer already advanced the draft past the caller's version
   * @expectedOutput 409 and the stored body unchanged, so a stale editor loses
   *                 its race rather than the newer text
   */
  it("should refuse a stale version and leave the stored body alone", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ body: "Newer text", version: 3 }));

    const failure = saveFailure(await saveDraft("user-1", ISSUE_ID, "Stale text", 2));

    expect(failure.status).toBe(409);
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("Newer text");
    expect(fakeDb.state.rows.reply_draft[0].version).toBe(3);
  });

  /**
   * @target saveDraft
   * @dependencies typedDb.update(reply_drafts), isNull(sendAttemptedAt)
   * @scenario A send from this draft is still unresolved, and another tab saves
   *           against the version it read
   * @expectedOutput 409 and the claimed body unchanged. The send deletes the row
   *                 on success, so accepting the edit would discard text the user
   *                 believes was saved and give no reason why.
   */
  it("should refuse to save over a draft a send has claimed", async () => {
    const claimedAt = new Date("2026-01-05T00:10:00.000Z");
    fakeDb.state.rows.reply_draft.push(
      replyDraftRow({ body: "On its way.", version: 2, sendAttemptedAt: claimedAt })
    );

    const failure = saveFailure(await saveDraft("user-1", ISSUE_ID, "Edited later", 2));

    expect(failure.status).toBe(409);
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("On its way.");
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).toEqual(claimedAt);
  });

  /**
   * @target saveDraft
   * @dependencies typedDb.update(reply_drafts)
   * @scenario The caller supplies a non-zero version for a draft that no longer
   *           exists, as happens when another tab deleted it
   * @expectedOutput 409 rather than a fresh row: a conditional update that
   *                 matched nothing must not become an insert
   */
  it("should refuse an update against a draft that does not exist", async () => {
    const failure = saveFailure(await saveDraft("user-1", ISSUE_ID, "Ghost", 4));

    expect(failure.status).toBe(409);
    expect(fakeDb.state.rows.reply_draft).toHaveLength(0);
  });
});

describe("findDraft", () => {
  /**
   * @target findDraft
   * @dependencies typedDb.select(reply_drafts)
   * @scenario A stored draft
   * @expectedOutput The client shape, with both instants as ISO strings
   */
  it("should return the stored draft in client shape", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow());

    const draft = await findDraft("user-1", ISSUE_ID);

    expect(draft).toEqual({
      id: DRAFT_ID,
      body: "Thanks for the report — can you share the stack trace?",
      version: 1,
      sendAttemptedAt: null,
      sendClaimId: null,
      updatedAt: "2026-01-05T00:00:00.000Z",
    });
  });

  /**
   * @target findDraft
   * @dependencies typedDb.select(reply_drafts)
   * @scenario The draft belongs to another user on the same issue
   * @expectedOutput `null`: drafts are per user, and the scoped select is the
   *                 only thing that enforces it
   */
  it("should not see another user's draft", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ userId: "user-2" }));

    expect(await findDraft("user-1", ISSUE_ID)).toBeNull();
  });

  /**
   * @target findDraft
   * @dependencies typedDb.select(reply_drafts)
   * @scenario Nothing has been written yet
   * @expectedOutput `null`
   */
  it("should return null when no draft exists", async () => {
    expect(await findDraft("user-1", ISSUE_ID)).toBeNull();
  });
});

describe("clearDraft", () => {
  /**
   * @target clearDraft
   * @dependencies typedDb.delete(reply_drafts)
   * @scenario The owner discards the draft
   * @expectedOutput The row is removed and reported as removed
   */
  it("should remove the draft and report that it did", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow());

    expect(await clearDraft("user-1", ISSUE_ID)).toBe("cleared");
    expect(fakeDb.state.rows.reply_draft).toHaveLength(0);
  });

  /**
   * @target clearDraft
   * @dependencies findDraft, isNull(sendAttemptedAt)
   * @scenario A send has claimed the draft and its outcome is still unknown
   * @expectedOutput `claimed` and the row survives. The row is the lock that
   *                 stops a second tab posting the same reply, so deleting it
   *                 would let a duplicate through while the first is resolved.
   */
  it("should refuse to remove a draft a send has claimed", async () => {
    fakeDb.state.rows.reply_draft.push(
      replyDraftRow({ body: "On its way.", sendAttemptedAt: new Date("2026-01-05T00:10:00.000Z") })
    );

    expect(await clearDraft("user-1", ISSUE_ID)).toBe("claimed");
    expect(fakeDb.state.rows.reply_draft).toHaveLength(1);
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("On its way.");
  });

  /**
   * @target clearDraft
   * @dependencies typedDb.delete(reply_drafts)
   * @scenario Another user's draft is the only one present
   * @expectedOutput `missing` and the row survives: the lookup is scoped by
   *                 user, so another user's draft is not there to remove
   */
  it("should not remove another user's draft", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ userId: "user-2" }));

    expect(await clearDraft("user-1", ISSUE_ID)).toBe("missing");
    expect(fakeDb.state.rows.reply_draft).toHaveLength(1);
  });
});

describe("sendReply — the published path", () => {
  /**
   * @target sendReply
   * @dependencies provider.createComment, clearDraft
   * @scenario A reply the provider accepts
   * @expectedOutput The comment is returned and the draft removed
   */
  it("should publish once, clear the draft, and return the comment", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ body: "Thanks for the report." }));

    const result = await sendReply("user-1", TARGET, "Thanks for the report.");

    expect(result).toEqual({
      ok: true,
      comment: comment(),
      draftCleared: true,
    });
    expect(provider.createComment).toHaveBeenCalledTimes(1);
    expect(provider.createComment).toHaveBeenCalledWith(
      "octo",
      "repo",
      7,
      "token-abc",
      "Thanks for the report."
    );
    expect(fakeDb.state.rows.reply_draft).toHaveLength(0);
  });

  /**
   * @target sendReply
   * @dependencies claimAttempt
   * @scenario The composer sends a body it never saved as a draft
   * @expectedOutput The attempt is claimed before the provider runs, so a crash
   *                 mid-request still leaves the duplicate guard closed
   */
  it("should claim the attempt before calling the provider", async () => {
    await sendReply("user-1", TARGET, "Thanks for the report.");

    const claim = fakeDb.state.log.indexOf("db:update:reply_draft");
    const call = fakeDb.state.log.indexOf("provider:createComment");

    expect(claim).toBeGreaterThanOrEqual(0);
    expect(call).toBeGreaterThan(claim);
  });

  /**
   * @target sendReply
   * @dependencies providerLimits
   * @scenario The body is one character over GitHub's 65,536-character comment limit
   * @expectedOutput 400 and no provider call: the provider would refuse it, and
   *                 a rejected irreversible write must not be attempted to find out
   */
  it("should reject a body the provider would refuse without calling it", async () => {
    const body = "x".repeat(providerLimits.github.comment + 1);

    const failure = sendFailure(await sendReply("user-1", TARGET, body));

    expect(failure.status).toBe(400);
    expect(failure.error).toContain(String(providerLimits.github.comment));
    expect(provider.createComment).not.toHaveBeenCalled();
    expect(fakeDb.state.log).not.toContain("provider:createComment");
    expect(mockGetProviderToken).not.toHaveBeenCalled();
  });

  /**
   * @target sendReply
   * @dependencies providerLimits
   * @scenario A body that GitHub would refuse but GitLab allows
   * @expectedOutput The send proceeds: the limit that applies is the
   *                 repository's own provider, not the strictest supported one
   */
  it("should accept that body on a provider with a larger limit", async () => {
    const body = "x".repeat(providerLimits.github.comment + 1);

    const result = await sendReply("user-1", { ...TARGET, provider: "gitlab" }, body);

    expect(result.ok).toBe(true);
    expect(provider.createComment).toHaveBeenCalledTimes(1);
  });

  /**
   * @target sendReply
   * @dependencies getProviderToken
   * @scenario No token is on file for the provider
   * @expectedOutput 403 and no provider call
   */
  it("should return 403 without a provider token", async () => {
    mockGetProviderToken.mockResolvedValue(null);

    const failure = sendFailure(await sendReply("user-1", TARGET, "Hello"));

    expect(failure.status).toBe(403);
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(fakeDb.state.log).not.toContain("provider:createComment");
  });

  /**
   * @target sendReply
   * @dependencies getProvider.createComment
   * @scenario The provider implementation has no comment support
   * @expectedOutput 501 and nothing recorded, so the draft is not left unconfirmed
   */
  it("should return 501 for a provider without comment support", async () => {
    mockGetProvider.mockReturnValue(providerWithoutComments());

    const failure = sendFailure(await sendReply("user-1", TARGET, "Hello"));

    expect(failure.status).toBe(501);
    expect(fakeDb.state.rows.reply_draft).toHaveLength(0);
  });
});

describe("sendReply — outcomes that are not success", () => {
  /**
   * @target sendReply
   * @dependencies ProviderApiError, clearAttempt
   * @scenario The provider answers 422: it received the request and refused it
   * @expectedOutput 502 with the attempt marker cleared, so the draft is
   *                 editable and sendable again
   */
  it("should clear the attempt when the provider rejects definitively", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ body: "Thanks." }));
    provider.createComment.mockRejectedValue(
      new ProviderApiError(422, "unprocessable", {
        provider: "github",
        operation: "createComment",
        owner: "octo",
        repo: "repo",
      })
    );

    const failure = sendFailure(await sendReply("user-1", TARGET, "Thanks."));

    expect(failure.status).toBe(502);
    expect(failure.unconfirmed).toBeUndefined();
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).toBeNull();
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("Thanks.");
  });

  /**
   * @target sendReply
   * @dependencies ProviderApiError
   * @scenario The provider answers 500, which may or may not have stored the comment
   * @expectedOutput 409 flagged unconfirmed, and the attempt marker left set so
   *                 Send stays withheld until the user checks the issue
   */
  it("should leave the attempt in place when a 500 might have posted", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ body: "Thanks." }));
    provider.createComment.mockRejectedValue(
      new ProviderApiError(500, "server error", {
        provider: "github",
        operation: "createComment",
        owner: "octo",
        repo: "repo",
      })
    );

    const failure = sendFailure(await sendReply("user-1", TARGET, "Thanks."));

    expect(failure.status).toBe(409);
    expect(failure.unconfirmed).toBe(true);
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).toBeInstanceOf(Date);
  });

  /**
   * @target sendReply
   * @dependencies provider.createComment
   * @scenario The request aborts with a bare error, as a timeout does
   * @expectedOutput 409 flagged unconfirmed: an aborted POST is the exact case
   *                 that must never be retried automatically
   */
  it("should treat a timeout as an unconfirmed send", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ body: "Thanks." }));
    provider.createComment.mockRejectedValue(new Error("The operation was aborted"));

    const failure = sendFailure(await sendReply("user-1", TARGET, "Thanks."));

    expect(failure.status).toBe(409);
    expect(failure.unconfirmed).toBe(true);
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).toBeInstanceOf(Date);
  });

  /**
   * @target sendReply
   * @dependencies claimAttempt
   * @scenario This tab is showing version 2, but another tab has already saved
   *           version 3 with different text
   * @expectedOutput 409, no provider call, and the newer draft left alone. A
   *                 claim that ignored the version would publish superseded text
   *                 and then delete the newer draft on success.
   */
  it("should refuse a send whose draft has moved on", async () => {
    fakeDb.state.rows.reply_draft.push(
      replyDraftRow({ body: "Newer text from another tab", version: 3 })
    );

    const failure = sendFailure(await sendReply("user-1", TARGET, "Stale text", 2));

    expect(failure.status).toBe(409);
    expect(provider.createComment).not.toHaveBeenCalled();
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("Newer text from another tab");
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).toBeNull();
  });

  /**
   * @target sendReply
   * @dependencies claimAttempt
   * @scenario A second send is attempted while the first outcome is unknown
   * @expectedOutput 409 flagged unconfirmed and the provider called exactly
   *                 once across both attempts — the duplicate-prevention guarantee
   */
  it("should refuse a second send while an earlier one is unconfirmed", async () => {
    fakeDb.state.rows.reply_draft.push(
      replyDraftRow({ body: "Thanks.", sendAttemptedAt: new Date("2026-01-05T00:10:00.000Z") })
    );

    const failure = sendFailure(await sendReply("user-1", TARGET, "Thanks."));

    expect(failure.status).toBe(409);
    expect(failure.unconfirmed).toBe(true);
    expect(provider.createComment).not.toHaveBeenCalled();
    expect(fakeDb.state.log).not.toContain("provider:createComment");
  });

  /**
   * @target sendReply
   * @dependencies recordAttempt
   * @scenario The first send times out, then the user retries
   * @expectedOutput The retry is refused, so the provider saw exactly one call
   *                 and the thread cannot receive the same prose twice
   */
  it("should let the provider see exactly one call across an ambiguous send and a retry", async () => {
    provider.createComment.mockRejectedValue(new Error("socket hang up"));

    const first = sendFailure(await sendReply("user-1", TARGET, "Thanks."));
    const second = sendFailure(await sendReply("user-1", TARGET, "Thanks."));

    expect(first.status).toBe(409);
    expect(first.unconfirmed).toBe(true);
    expect(second.status).toBe(409);
    expect(second.unconfirmed).toBe(true);
    expect(provider.createComment).toHaveBeenCalledTimes(1);
  });

  /**
   * @target sendReply
   * @dependencies recordAttempt, clearAttempt
   * @scenario A send is refused definitively after an earlier ambiguous one
   *           was reconciled
   * @expectedOutput The attempt marker is gone, so a draft that failed twice in
   *                 a row is still editable
   */
  it("should keep the draft's text across a failed send", async () => {
    const body = "Could you share the stack trace?";
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ body, version: 4 }));
    provider.createComment.mockRejectedValue(
      new ProviderApiError(403, "forbidden", {
        provider: "github",
        operation: "createComment",
        owner: "octo",
        repo: "repo",
      })
    );

    await sendReply("user-1", TARGET, body);

    expect(fakeDb.state.rows.reply_draft[0].body).toBe(body);
    expect(fakeDb.state.rows.reply_draft[0].version).toBe(4);
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).toBeNull();
  });

  /**
   * @target sendReply
   * @dependencies claimAttempt
   * @scenario The composer never autosaved, and the send then becomes ambiguous
   * @expectedOutput The draft the claim created holds the submitted text, so
   *                 "your draft has been kept" is true of something
   */
  it("should store the submitted text when the attempt creates the draft", async () => {
    provider.createComment.mockRejectedValue(new Error("socket hang up"));

    await sendReply("user-1", TARGET, "Saved text");

    expect(fakeDb.state.rows.reply_draft).toHaveLength(1);
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("Saved text");
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).toBeInstanceOf(Date);
  });
});

describe("resolveIdentity", () => {
  /**
   * @target resolveIdentity
   * @dependencies provider.getAuthenticatedUser
   * @scenario The login has never been resolved
   * @expectedOutput It is fetched once, stored, and returned
   */
  it("should fetch the login once and cache it", async () => {
    const first = await resolveIdentity("user-1", "github");
    const second = await resolveIdentity("user-1", "github");

    expect(first).toEqual({ login: "me", avatar: null });
    expect(second).toEqual({ login: "me", avatar: null });
    expect(provider.getAuthenticatedUser).toHaveBeenCalledTimes(1);
    expect(mockGetProviderToken).toHaveBeenCalledTimes(1);
    expect(fakeDb.state.rows.provider_identity).toHaveLength(1);
  });

  /**
   * @target resolveIdentity
   * @dependencies typedDb.select(provider_identity)
   * @scenario A login is already cached
   * @expectedOutput The cached value is returned with no provider call at all
   */
  it("should answer from the cache without touching the provider", async () => {
    fakeDb.state.rows.provider_identity.push(
      providerIdentityRow({ login: "cached-me", fetchedAt: new Date() })
    );

    const identity = await resolveIdentity("user-1", "github");

    expect(identity).toEqual({ login: "cached-me", avatar: null });
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockGetProviderToken).not.toHaveBeenCalled();
  });

  /**
   * @target resolveIdentity
   * @dependencies getAuthenticatedUser, fetchedAt
   * @scenario The cached login was recorded more than a day ago, as it would be
   *           after reconnecting a different provider account
   * @expectedOutput The login is re-read and the cache updated. A cache that
   *                 never expires leaves the old login in place, so the new
   *                 account's comments read as somebody else's and every issue
   *                 they touch resurfaces.
   */
  it("should refresh a login cached more than a day ago", async () => {
    fakeDb.state.rows.provider_identity.push(
      providerIdentityRow({
        login: "old-account",
        fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      })
    );
    provider.getAuthenticatedUser = vi.fn().mockResolvedValue({ login: "new-account", avatar: null });

    const identity = await resolveIdentity("user-1", "github");

    expect(identity).toEqual({ login: "new-account", avatar: null });
    expect(fakeDb.state.rows.provider_identity[0].login).toBe("new-account");
  });

  /**
   * @target resolveIdentity
   * @dependencies getAuthenticatedUser
   * @scenario A stale cache entry and a refresh that fails
   * @expectedOutput The cached login. Returning null would make the follow-up
   *                 check treat the user's own comments as external.
   */
  it("should keep the cached login when the refresh fails", async () => {
    fakeDb.state.rows.provider_identity.push(
      providerIdentityRow({
        login: "old-account",
        fetchedAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      })
    );
    provider.getAuthenticatedUser = vi.fn().mockResolvedValue(null);

    const identity = await resolveIdentity("user-1", "github");

    expect(identity).toEqual({ login: "old-account", avatar: null });
  });

  /**
   * @target resolveIdentity
   * @dependencies getProviderToken
   * @scenario No token is available for the provider
   * @expectedOutput `null` and nothing cached, so a later attempt can still resolve
   */
  it("should return null without a token", async () => {
    mockGetProviderToken.mockResolvedValue(null);

    expect(await resolveIdentity("user-1", "github")).toBeNull();
    expect(fakeDb.state.rows.provider_identity).toHaveLength(0);
  });
});

describe("releaseSendClaim", () => {
  /**
   * @target releaseSendClaim
   * @dependencies reply_drafts.sendClaimId
   * @scenario The tab releases an attempt that another send has since replaced
   * @expectedOutput `mismatch`, and the newer claim is still held. Releasing
   *                 whatever marker happens to be set would free a send that is
   *                 still running, and a second call could publish the same text.
   */
  it("should refuse to release a claim another attempt now holds", async () => {
    fakeDb.state.rows.reply_draft.push(
      replyDraftRow({
        sendAttemptedAt: new Date("2026-01-05T00:00:00.000Z"),
        sendClaimId: "claim-new",
      })
    );

    const outcome = await releaseSendClaim("user-1", ISSUE_ID, "claim-old");

    expect(outcome).toBe("mismatch");
    expect(fakeDb.state.rows.reply_draft[0].sendClaimId).toBe("claim-new");
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).not.toBeNull();
  });

  /**
   * @target releaseSendClaim
   * @dependencies reply_drafts.sendInFlightUntil
   * @scenario The provider call has not finished yet
   * @expectedOutput `in_flight`, and the claim is kept. Releasing here lets a
   *                 second call start while the first can still publish.
   */
  it("should refuse to release while the provider call is still running", async () => {
    fakeDb.state.rows.reply_draft.push(
      replyDraftRow({
        sendAttemptedAt: new Date("2026-01-05T00:00:00.000Z"),
        sendClaimId: "claim-1",
        sendInFlightUntil: new Date(Date.now() + 60_000),
      })
    );

    const outcome = await releaseSendClaim("user-1", ISSUE_ID, "claim-1");

    expect(outcome).toBe("in_flight");
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).not.toBeNull();
  });

  /**
   * @target releaseSendClaim
   * @dependencies reply_drafts.sendInFlightUntil
   * @scenario The lease has expired, as it would after the process died mid-call
   * @expectedOutput `released`. A lease that never expires would make the draft
   *                 permanently unreleasable, which is the failure it exists to
   *                 avoid.
   */
  it("should release once the lease has expired", async () => {
    fakeDb.state.rows.reply_draft.push(
      replyDraftRow({
        sendAttemptedAt: new Date("2026-01-05T00:00:00.000Z"),
        sendClaimId: "claim-1",
        sendInFlightUntil: new Date(Date.now() - 1_000),
      })
    );

    const outcome = await releaseSendClaim("user-1", ISSUE_ID, "claim-1");

    expect(outcome).toBe("released");
    expect(fakeDb.state.rows.reply_draft[0].sendAttemptedAt).toBeNull();
    expect(fakeDb.state.rows.reply_draft[0].sendClaimId).toBeNull();
  });

  /**
   * @target releaseSendClaim
   * @dependencies none
   * @scenario The claim is already gone
   * @expectedOutput `missing`. "This attempt is settled" is already true, so the
   *                 route answers success rather than an error the user cannot
   *                 act on.
   */
  it("should report an absent claim rather than failing", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ sendAttemptedAt: null }));

    await expect(releaseSendClaim("user-1", ISSUE_ID, "claim-1")).resolves.toBe("missing");
  });
});
