/**
 * @module tests/unit/app/api/issues/comments
 *
 * Unit tests for `GET /api/issues/[id]/comments`, the discussion pane's read.
 *
 * The route has to answer three different kinds of "nothing": a provider that
 * cannot read comments at all (`supported: false`), a thread that is genuinely
 * empty (`comments: []` with `supported: true`), and a read that failed (502).
 * Collapsing the first into the second is the bug this file exists to prevent —
 * "nobody has replied" and "we cannot tell" are different answers to somebody
 * deciding whether to wait for a reply.
 *
 * It also owns the page bound. A caller can ask for anything; the route clamps
 * to 100, because the provider's own maximum is a fact about the provider rather
 * than a suggestion from the client.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/issues/[id]/comments/route";
import { auth } from "@/auth";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import { checkPersistentRateLimit } from "@/lib/rate-limit";
import { ProviderApiError } from "@/lib/provider-error";
import type { IssueProvider, ProviderComment } from "@/lib/provider-interface";
import { ISSUE_ID, fakeDb, issueRow, repoRow } from "../../../support/fake-db";

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

/** A stored comment as an adapter returns it. */
function comment(overrides: Partial<ProviderComment> = {}): ProviderComment {
  return {
    id: "100",
    body: "Any update on this?",
    author: "nadia",
    authorAvatar: null,
    createdAt: new Date("2026-02-01T10:00:00.000Z"),
    updatedAt: new Date("2026-02-01T10:00:00.000Z"),
    isSystem: false,
    url: "https://github.com/octo/repo/issues/7#issuecomment-100",
    ...overrides,
  };
}

/** A provider stub whose comment read is the only behaviour under test. */
function providerStub(page = { comments: [comment()], olderCursor: "3" }) {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    fetchComments: vi.fn().mockResolvedValue(page),
  } satisfies IssueProvider;
}

async function getComments(query = "", issueId = ISSUE_ID) {
  const req = new Request(`http://localhost/api/issues/${issueId}/comments${query}`);
  await GET(req, { params: Promise.resolve({ id: issueId }) });
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

describe("GET /api/issues/:id/comments — authorization", () => {
  /**
   * @target GET /api/issues/:id/comments
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and no database read
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await getComments();

    expect(res.status).toBe(401);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies loadReplyTarget
   * @scenario The issue lives in another user's repository
   * @expectedOutput 404 and no provider call
   */
  it("should return 404 for a foreign issue", async () => {
    fakeDb.state.rows.repo[0] = repoRow({ userId: "user-2" });

    const res = await getComments();

    expect(res.status).toBe(404);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies getProviderToken
   * @scenario No token is available for the provider
   * @expectedOutput 403 and no provider call
   */
  it("should return 403 without a provider token", async () => {
    mockGetProviderToken.mockResolvedValue(null);

    const res = await getComments();

    expect(res.status).toBe(403);
    expect(provider.fetchComments).not.toHaveBeenCalled();
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies checkPersistentRateLimit
   * @scenario The user has exceeded the discussion-read allowance
   * @expectedOutput 429 and no provider call, so a client cannot use the route
   *                 as an amplifier against the provider
   */
  it("should return 429 when the read bucket is exhausted", async () => {
    mockRateLimit.mockResolvedValue(true);

    const res = await getComments();

    expect(res.status).toBe(429);
    expect(provider.fetchComments).not.toHaveBeenCalled();
    expect(mockRateLimit).toHaveBeenCalledWith("provider:comments:user-1", 60, 60_000);
  });
});

describe("GET /api/issues/:id/comments — provider support", () => {
  /**
   * @target GET /api/issues/:id/comments
   * @dependencies getProvider.fetchComments
   * @scenario The provider implementation has no comment reading
   * @expectedOutput `supported: false`, so the pane can say the discussion is
   *                 unavailable instead of implying the thread is empty
   */
  it("should report supported as false when the provider cannot read comments", async () => {
    mockGetProvider.mockReturnValue({
      fetchIssues: vi.fn().mockResolvedValue([]),
      updateIssue: vi.fn().mockResolvedValue(undefined),
      getRepoPermission: vi.fn().mockResolvedValue("write"),
    } satisfies IssueProvider);

    const res = await getComments();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ comments: [], olderCursor: null, supported: false });
    expect(mockGetProviderToken).not.toHaveBeenCalled();
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies provider.fetchComments
   * @scenario A supported provider with an empty thread
   * @expectedOutput `supported: true` with no comments: a real "nobody replied"
   */
  it("should report supported as true for a genuinely empty thread", async () => {
    provider.fetchComments.mockResolvedValue({ comments: [], olderCursor: null });

    const res = await getComments();

    expect(res.body).toEqual({ comments: [], olderCursor: null, supported: true });
  });
});

describe("GET /api/issues/:id/comments — pagination", () => {
  /**
   * @target GET /api/issues/:id/comments
   * @dependencies provider.fetchComments
   * @scenario The caller supplies a cursor and a limit
   * @expectedOutput Both are passed through, so older history can be walked
   */
  it("should plumb the cursor and limit through to the provider", async () => {
    const res = await getComments("?cursor=4&limit=10");

    expect(res.status).toBe(200);
    expect(provider.fetchComments).toHaveBeenCalledWith("octo", "repo", 7, "token-abc", {
      cursor: "4",
      limit: 10,
    });
    expect((res.body as { olderCursor: string }).olderCursor).toBe("3");
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies DEFAULT_PAGE_SIZE
   * @scenario The caller supplies no query at all
   * @expectedOutput The default page size, with no cursor
   */
  it("should use the default page size when nothing is asked for", async () => {
    await getComments();

    expect(provider.fetchComments).toHaveBeenCalledWith("octo", "repo", 7, "token-abc", {
      cursor: null,
      limit: 30,
    });
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies MAX_PAGE_SIZE
   * @scenario The caller asks for 5000
   * @expectedOutput Clamped to 100, the provider's own maximum
   */
  it("should clamp a limit over 100", async () => {
    await getComments("?limit=5000");

    expect(provider.fetchComments).toHaveBeenCalledWith("octo", "repo", 7, "token-abc", {
      cursor: null,
      limit: 100,
    });
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies MAX_PAGE_SIZE
   * @scenario The caller asks for zero or a negative page
   * @expectedOutput Clamped to 1 rather than forwarded, because a page of zero
   *                 rows would look like an empty thread
   */
  it("should clamp a limit below 1", async () => {
    await getComments("?limit=0");

    expect(provider.fetchComments).toHaveBeenCalledWith("octo", "repo", 7, "token-abc", {
      cursor: null,
      limit: 1,
    });
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies MAX_PAGE_SIZE
   * @scenario The limit is not a number
   * @expectedOutput The default page size, not `NaN`
   */
  it("should fall back to the default for a non-numeric limit", async () => {
    await getComments("?limit=lots");

    expect(provider.fetchComments).toHaveBeenCalledWith("octo", "repo", 7, "token-abc", {
      cursor: null,
      limit: 30,
    });
  });
});

describe("GET /api/issues/:id/comments — shape and failures", () => {
  /**
   * @target GET /api/issues/:id/comments
   * @dependencies provider.fetchComments
   * @scenario One stored comment
   * @expectedOutput The neutral shape with both instants as ISO strings, so the
   *                 pane never re-derives a date from a provider payload
   */
  it("should serialise each comment with ISO instants", async () => {
    const res = await getComments();

    expect(res.body).toEqual({
      comments: [
        {
          id: "100",
          body: "Any update on this?",
          author: "nadia",
          authorAvatar: null,
          createdAt: "2026-02-01T10:00:00.000Z",
          updatedAt: "2026-02-01T10:00:00.000Z",
          isSystem: false,
          url: "https://github.com/octo/repo/issues/7#issuecomment-100",
        },
      ],
      olderCursor: "3",
      supported: true,
    });
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies ProviderApiError
   * @scenario The provider answers 500
   * @expectedOutput 502 with a message that does not leak the provider's body
   */
  it("should return 502 when the provider fails", async () => {
    provider.fetchComments.mockRejectedValue(
      new ProviderApiError(500, "internal", {
        provider: "github",
        operation: "fetchComments",
        owner: "octo",
        repo: "repo",
      })
    );

    const res = await getComments();

    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("Could not load this discussion right now.");
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies none
   * @scenario The request cannot reach the provider at all — DNS, a reset
   *           socket, a self-hosted instance that is down
   * @expectedOutput 502. `fetch` rejects with a plain `TypeError`, not a
   *                 `ProviderApiError`, and rethrowing it made an unreachable
   *                 provider look like a defect in this app.
   */
  it("should return 502 when the provider is unreachable", async () => {
    provider.fetchComments.mockRejectedValue(new TypeError("fetch failed"));

    const res = await getComments();

    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("Could not load this discussion right now.");
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies ProviderApiError.isAuthError
   * @scenario The stored token is rejected by the provider
   * @expectedOutput 403, because the fix is to re-authenticate rather than retry
   */
  it("should return 403 when the provider reports an auth error", async () => {
    provider.fetchComments.mockRejectedValue(
      new ProviderApiError(401, "bad credentials", {
        provider: "github",
        operation: "fetchComments",
        owner: "octo",
        repo: "repo",
      })
    );

    const res = await getComments();

    expect(res.status).toBe(403);
  });

  /**
   * @target GET /api/issues/:id/comments
   * @dependencies ProviderApiError
   * @scenario The provider is rate limited
   * @expectedOutput 502 rather than 403: a 429 is not an auth failure, and
   *                 telling the user to re-authenticate would be wrong
   */
  it("should not treat a rate limit as an auth error", async () => {
    provider.fetchComments.mockRejectedValue(
      new ProviderApiError(429, "slow down", {
        provider: "github",
        operation: "fetchComments",
        owner: "octo",
        repo: "repo",
      })
    );

    const res = await getComments();

    expect(res.status).toBe(502);
  });
});
