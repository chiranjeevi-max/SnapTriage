/**
 * @module tests/unit/app/api/issues/replies
 *
 * Unit tests for `POST /api/issues/[id]/replies`, the only endpoint in the app
 * that publishes something a third party can see.
 *
 * What is held in place:
 *
 * - **Ownership is the join.** An issue in another user's repository is a 404,
 *   and the publisher is never reached, so a guessed id cannot post a comment.
 * - **An unconfirmed send is distinguishable from a failure.** The 409 body
 *   carries `unconfirmed: true`, which is what tells the composer not to offer
 *   the button again; a 502 does not, because the provider answered.
 * - **The response carries the provider's own comment**, with its instant as an
 *   ISO string, so the client can render what was actually stored.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/issues/[id]/replies/route";
import { auth } from "@/auth";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import { checkPersistentRateLimit } from "@/lib/rate-limit";
import { ProviderApiError } from "@/lib/provider-error";
import { providerLimits, type IssueProvider, type ProviderComment } from "@/lib/provider-interface";
import {
  ISSUE_ID,
  REPO_ID,
  fakeDb,
  issueRow,
  replyDraftRow,
  repoRow,
} from "../../../support/fake-db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/features/auth/get-provider-token", () => ({ getProviderToken: vi.fn() }));
vi.mock("@/lib/providers", () => ({ getProvider: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkPersistentRateLimit: vi.fn() }));
vi.mock("@/lib/db/query", async () => {
  const { fakeDb } = await import("../../../support/fake-db");
  return { typedDb: fakeDb.typedDb };
});
vi.mock("@/lib/logger", () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockAuth = vi.mocked(auth);
const mockGetProviderToken = vi.mocked(getProviderToken);
const mockGetProvider = vi.mocked(getProvider);
const mockRateLimit = vi.mocked(checkPersistentRateLimit);

let lastStatus = 0;
let lastBody: unknown = null;

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => {
      lastStatus = init?.status ?? 200;
      lastBody = body;
      return { status: lastStatus, body } as never;
    }),
  },
}));

/** The comment the stub provider claims to have created. */
function createdComment(overrides: Partial<ProviderComment> = {}): ProviderComment {
  return {
    id: "1001",
    body: "Thanks for the report.",
    author: "me",
    authorAvatar: "https://avatars.test/me.png",
    createdAt: new Date("2026-02-01T12:00:00.000Z"),
    updatedAt: new Date("2026-02-01T12:00:00.000Z"),
    isSystem: false,
    url: "https://github.com/octo/repo/issues/7#issuecomment-1001",
    ...overrides,
  };
}

/** A provider stub whose createComment records the call in the operation log. */
function providerStub() {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    createComment: vi.fn(async () => {
      fakeDb.state.log.push("provider:createComment");
      return createdComment();
    }),
  } satisfies IssueProvider;
}

async function postReply(body: unknown, issueId = ISSUE_ID) {
  const req = new Request(`http://localhost/api/issues/${issueId}/replies`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await POST(req, { params: Promise.resolve({ id: issueId }) });
  return { status: lastStatus, body: lastBody };
}

let provider: ReturnType<typeof providerStub>;

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  lastStatus = 0;
  lastBody = null;
  provider = providerStub();
  mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
  mockGetProviderToken.mockResolvedValue("token-abc");
  mockGetProvider.mockReturnValue(provider);
  mockRateLimit.mockResolvedValue(false);
  fakeDb.state.rows.repo.push(repoRow());
  fakeDb.state.rows.issue.push(issueRow());
});

describe("POST /api/issues/:id/replies — authorization", () => {
  /**
   * @target POST /api/issues/:id/replies
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and no database read
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await postReply({ body: "Thanks" });

    expect(res.status).toBe(401);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies loadReplyTarget
   * @scenario The issue lives in another user's repository
   * @expectedOutput 404 and the provider is never constructed
   */
  it("should return 404 for a foreign issue", async () => {
    fakeDb.state.rows.repo[0] = repoRow({ id: REPO_ID, userId: "user-2" });

    const res = await postReply({ body: "Thanks" });

    expect(res.status).toBe(404);
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(fakeDb.state.log).not.toContain("provider:createComment");
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies checkPersistentRateLimit
   * @scenario The user has sent more replies than the window allows
   * @expectedOutput 429 with no provider call and no `unconfirmed` flag: the
   *                 refusal is definitive, so Send must stay available
   */
  it("should return 429 when the send bucket is exhausted", async () => {
    mockRateLimit.mockResolvedValue(true);

    const res = await postReply({ body: "Thanks" });

    expect(res.status).toBe(429);
    expect((res.body as { unconfirmed?: true }).unconfirmed).toBeUndefined();
    expect((res.body as { error: string }).error).toContain("Too many replies");
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(fakeDb.state.log).not.toContain("provider:createComment");
    // The bound is checked before the claim, so a refused request leaves no
    // attempt marker and no draft behind.
    expect(fakeDb.state.rows.reply_draft).toHaveLength(0);
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies checkPersistentRateLimit
   * @scenario The bucket is exhausted and the body is malformed
   * @expectedOutput 429, not 400. The limit is checked before the body is
   *                 parsed, so a runaway client cannot spend the window on
   *                 requests that never reach the provider.
   */
  it("should refuse an exhausted bucket before validating the body", async () => {
    mockRateLimit.mockResolvedValue(true);

    const res = await postReply({});

    expect(res.status).toBe(429);
    expect(fakeDb.state.rows.reply_draft).toHaveLength(0);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies checkPersistentRateLimit
   * @scenario An authenticated send under the allowance
   * @expectedOutput The bucket is keyed by the user, not the client address
   */
  it("should key the send bucket by user", async () => {
    await postReply({ body: "Thanks" });

    expect(mockRateLimit).toHaveBeenCalledWith("reply:send:user-1", 10, 60_000);
  });
});

describe("POST /api/issues/:id/replies — validation", () => {
  /**
   * @target POST /api/issues/:id/replies
   * @dependencies sendReplySchema
   * @scenario The body is an empty string
   * @expectedOutput 400 and no provider call: an empty comment is not a reply
   */
  it("should return 400 for an empty body", async () => {
    const res = await postReply({ body: "" });

    expect(res.status).toBe(400);
    expect(fakeDb.state.log).not.toContain("provider:createComment");
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies sendReplySchema
   * @scenario The body is present but whitespace only
   * @expectedOutput 400, since trimming happens before the length check
   */
  it("should return 400 for a whitespace-only body", async () => {
    const res = await postReply({ body: "   \n\t " });

    expect(res.status).toBe(400);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies sendReplySchema
   * @scenario `body` is missing entirely
   * @expectedOutput 400 rather than an unhandled throw
   */
  it("should return 400 when body is missing", async () => {
    const res = await postReply({});

    expect(res.status).toBe(400);
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies providerLimits
   * @scenario The body is over GitHub's comment limit
   * @expectedOutput 400 from the service, and the provider is never called
   */
  it("should return 400 for a body over the provider limit", async () => {
    const res = await postReply({ body: "x".repeat(providerLimits.github.comment + 1) });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain(String(providerLimits.github.comment));
    expect(fakeDb.state.log).not.toContain("provider:createComment");
  });
});

describe("POST /api/issues/:id/replies — outcomes", () => {
  /**
   * @target POST /api/issues/:id/replies
   * @dependencies sendReply
   * @scenario The provider accepts the comment
   * @expectedOutput 201 with the provider's comment, its instant as an ISO string
   */
  it("should return 201 with the published comment", async () => {
    const res = await postReply({ body: "Thanks for the report." });

    expect(res.status).toBe(201);
    // Every field `ReplyComment` declares, so a consumer can treat the response
    // as one without encountering `undefined` where the type promises a value.
    expect(res.body).toEqual({
      ok: true,
      comment: {
        id: "1001",
        body: "Thanks for the report.",
        author: "me",
        authorAvatar: "https://avatars.test/me.png",
        createdAt: "2026-02-01T12:00:00.000Z",
        updatedAt: "2026-02-01T12:00:00.000Z",
        isSystem: false,
        url: "https://github.com/octo/repo/issues/7#issuecomment-1001",
      },
    });
    // What was actually sent, not just that a send happened. The stub would
    // happily echo a different body, so this is the assertion that catches a
    // route forwarding the wrong text.
    expect(provider.createComment).toHaveBeenCalledTimes(1);
    expect(provider.createComment).toHaveBeenCalledWith(
      "octo",
      "repo",
      7,
      "token-abc",
      "Thanks for the report."
    );
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies sendReply
   * @scenario The provider answers 500, so the comment may or may not exist
   * @expectedOutput 409 carrying `unconfirmed: true`, which is what withholds
   *                 Send in the composer
   */
  it("should surface an unconfirmed send as a 409 with the flag", async () => {
    provider.createComment.mockRejectedValue(
      new ProviderApiError(500, "server error", {
        provider: "github",
        operation: "createComment",
        owner: "octo",
        repo: "repo",
      })
    );

    const res = await postReply({ body: "Thanks" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ unconfirmed: true });
    expect((res.body as { error: string }).error).toContain("could not confirm");
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies sendReply
   * @scenario An earlier send is unresolved and the client tries again
   * @expectedOutput 409 with the flag and no second provider call
   */
  it("should refuse a retry while a send is unconfirmed", async () => {
    fakeDb.state.rows.reply_draft.push(
      replyDraftRow({ sendAttemptedAt: new Date("2026-01-05T00:10:00.000Z") })
    );

    const res = await postReply({ body: "Thanks" });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ unconfirmed: true });
    expect(provider.createComment).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies sendReply
   * @scenario The provider refuses the body definitively
   * @expectedOutput 422 without the unconfirmed flag, since the provider did
   *                 answer. Not 5xx: the client reads every 5xx as possibly
   *                 published, which would withhold Send on an outright refusal.
   */
  it("should return 422 when the provider rejects the reply", async () => {
    provider.createComment.mockRejectedValue(
      new ProviderApiError(422, "unprocessable", {
        provider: "github",
        operation: "createComment",
        owner: "octo",
        repo: "repo",
      })
    );

    const res = await postReply({ body: "Thanks" });

    // 422 because the refusal is definitive. The client treats every 5xx as
    // possibly-published, so reporting a refusal that way would withhold Send on
    // a reply the provider declined outright.
    expect(res.status).toBe(422);
    expect((res.body as { unconfirmed?: true }).unconfirmed).toBeUndefined();
    expect((res.body as { error: string }).error).toContain("rejected");
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies getProviderToken
   * @scenario No provider token is on file
   * @expectedOutput 403 and no provider call
   */
  it("should return 403 without a provider token", async () => {
    mockGetProviderToken.mockResolvedValue(null);

    const res = await postReply({ body: "Thanks" });

    expect(res.status).toBe(403);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/issues/:id/replies
   * @dependencies sendReply, REPLY_SEND_MIN_LEASE_MS
   * @scenario The database clock at check time runs 100s ahead, so the claim's
   *           lease is too short to cover the provider call
   * @expectedOutput 409 without `unconfirmed`: nothing was posted, so the
   *                 composer keeps Send available.
   */
  it("should return a definitive 409 when the claim's lease is too short", async () => {
    fakeDb.state.dbNowOffsetMs = 100_000;

    try {
      const res = await postReply({ body: "Thanks" });

      expect(res.status).toBe(409);
      expect((res.body as { unconfirmed?: true }).unconfirmed).toBeUndefined();
      expect((res.body as { error: string }).error).toContain("did not start");
      expect(provider.createComment).not.toHaveBeenCalled();
    } finally {
      fakeDb.state.dbNowOffsetMs = undefined;
    }
  });
});
