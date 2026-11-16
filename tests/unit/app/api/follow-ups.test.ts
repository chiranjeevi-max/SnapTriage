/**
 * @module tests/unit/app/api/follow-ups
 *
 * Unit tests for `GET`/`POST /api/follow-ups`, the inbox route.
 *
 * Freshness is the whole point of the `GET` body. Nothing polls in the
 * background, so the response has to say when the list was last checked rather
 * than implying it is live. `checkedAt` is therefore the newest entry time —
 * the freshest fact available — and `null` when no entry has ever been checked,
 * because a fabricated timestamp would be worse than admitting the list is stale.
 *
 * `POST` runs one bounded pass and returns its summary so the inbox can report
 * how many issues it examined, surfaced, and could not reach.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/follow-ups/route";
import { auth } from "@/auth";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import type { IssueProvider, ProviderComment } from "@/lib/provider-interface";
import {
  ISSUE_ID,
  OTHER_ISSUE_ID,
  fakeDb,
  followUpRow,
  issueRow,
  providerIdentityRow,
  repoRow,
} from "../../support/fake-db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
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

const mockAuth = vi.mocked(auth);
const mockGetProviderToken = vi.mocked(getProviderToken);
const mockGetProvider = vi.mocked(getProvider);

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

/** A reporter's comment, newer than the default fixture baseline. */
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

/** A provider stub whose comment read is configurable per test. */
function providerStub(page = { comments: [] as ProviderComment[], olderCursor: null }) {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    fetchComments: vi.fn().mockResolvedValue(page),
    getAuthenticatedUser: vi.fn().mockResolvedValue({ login: "me", avatar: null }),
  } satisfies IssueProvider;
}

async function getFollowUps() {
  await GET();
  return { status: lastStatus, body: lastBody };
}

async function postFollowUps() {
  await POST();
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
  fakeDb.state.rows.repo.push(repoRow());
  fakeDb.state.rows.issue.push(issueRow());
  fakeDb.state.rows.provider_identity.push(providerIdentityRow());
});

describe("GET /api/follow-ups", () => {
  /**
   * @target GET /api/follow-ups
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and no database read
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await getFollowUps();

    expect(res.status).toBe(401);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target GET /api/follow-ups
   * @dependencies listFollowUps
   * @scenario The user follows one issue that has been checked
   * @expectedOutput The entry list plus its newest check instant as `checkedAt`
   */
  it("should return the entries and the newest check time", async () => {
    fakeDb.state.rows.follow_up.push(
      followUpRow({ reason: "reply", checkedAt: new Date("2026-02-03T09:00:00.000Z") })
    );

    const res = await getFollowUps();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      entries: [
        {
          issueId: ISSUE_ID,
          repoId: "11111111-1111-4111-8111-111111111111",
          number: 7,
          title: "Crash on start",
          url: "https://github.com/octo/repo/issues/7",
          provider: "github",
          fullName: "octo/repo",
          state: "waiting",
          reason: "reply",
          checkedAt: "2026-02-03T09:00:00.000Z",
          due: true,
        },
      ],
      checkedAt: "2026-02-03T09:00:00.000Z",
    });
  });

  /**
   * @target GET /api/follow-ups
   * @dependencies listFollowUps
   * @scenario Two entries were checked at different times
   * @expectedOutput `checkedAt` is the later of the two, not the first in the list
   */
  it("should report the newest of several check times", async () => {
    fakeDb.state.rows.issue.push(
      issueRow({ id: OTHER_ISSUE_ID, number: 8, providerIssueId: "gh-8" })
    );
    fakeDb.state.rows.follow_up.push(
      followUpRow({ id: "follow-up-a", checkedAt: new Date("2026-02-05T00:00:00.000Z") }),
      followUpRow({
        id: "follow-up-b",
        issueId: OTHER_ISSUE_ID,
        checkedAt: new Date("2026-02-02T00:00:00.000Z"),
        updatedAt: new Date("2026-02-06T00:00:00.000Z"),
      })
    );

    const res = await getFollowUps();

    expect((res.body as { checkedAt: string }).checkedAt).toBe("2026-02-05T00:00:00.000Z");
  });

  /**
   * @target GET /api/follow-ups
   * @dependencies listFollowUps
   * @scenario The user follows an issue that has never been checked
   * @expectedOutput `checkedAt: null`, so the UI can say the list is unverified
   *                 instead of presenting it as current
   */
  it("should report null for an entry that has never been checked", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ checkedAt: null }));

    const res = await getFollowUps();

    expect((res.body as { checkedAt: string | null }).checkedAt).toBeNull();
  });

  /**
   * @target GET /api/follow-ups
   * @dependencies listFollowUps
   * @scenario The user follows nothing
   * @expectedOutput An empty list with a null freshness marker
   */
  it("should return an empty list and null when nothing is followed", async () => {
    const res = await getFollowUps();

    expect(res.body).toEqual({ entries: [], checkedAt: null });
  });

  /**
   * @target GET /api/follow-ups
   * @dependencies listFollowUps
   * @scenario Another user follows the same issue
   * @expectedOutput Empty: the list is scoped to the caller
   */
  it("should not list another user's follow-ups", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ userId: "user-2" }));

    const res = await getFollowUps();

    expect(res.body).toEqual({ entries: [], checkedAt: null });
  });
});

describe("POST /api/follow-ups", () => {
  /**
   * @target POST /api/follow-ups
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and no provider call
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await postFollowUps();

    expect(res.status).toBe(401);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/follow-ups
   * @dependencies runFollowUpCheck
   * @scenario A qualifying reply has landed since the baseline
   * @expectedOutput The pass summary, so the inbox can report what it did
   */
  it("should return the summary of one check pass", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ checkedAt: null }));
    provider.fetchComments.mockResolvedValue({ comments: [comment()], olderCursor: null });

    const res = await postFollowUps();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checked: 1, surfaced: 1, skipped: 0 });
    expect(fakeDb.state.rows.follow_up[0].reason).toBe("reply");
  });

  /**
   * @target POST /api/follow-ups
   * @dependencies runFollowUpCheck
   * @scenario Nothing is waiting
   * @expectedOutput A zero summary rather than an error
   */
  it("should return a zero summary when nothing is waiting", async () => {
    const res = await postFollowUps();

    expect(res.body).toEqual({ checked: 0, surfaced: 0, skipped: 0 });
    expect(provider.fetchComments).not.toHaveBeenCalled();
  });
});
