/**
 * @module tests/unit/app/api/issues/follow-up
 *
 * Unit tests for `PUT`/`DELETE /api/issues/[id]/follow-up`.
 *
 * Three explicit transitions rather than an on/off flag, because they mean
 * different things: `wait` starts a watch, `review` acknowledges what came back
 * and moves the baseline, `stop` abandons it. The tests hold two things apart
 * that are easy to conflate:
 *
 * - **A review with no comment is not an error.** "I looked and there was
 *   nothing" is a legitimate acknowledgement, so it records a null baseline.
 * - **An unparseable `commentAt` is an error.** Silently treating it as null
 *   would widen the baseline window instead of narrowing it, which is the wrong
 *   direction for a filter whose job is to suppress repeats.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE, PUT } from "@/app/api/issues/[id]/follow-up/route";
import { auth } from "@/auth";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import { checkPersistentRateLimit } from "@/lib/rate-limit";
import type { IssueProvider } from "@/lib/provider-interface";
import {
  ISSUE_ID,
  fakeDb,
  followUpRow,
  issueRow,
  providerIdentityRow,
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
  providerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
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

/** A provider stub that reports an empty discussion, so arming uses a null baseline. */
function providerStub() {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    fetchComments: vi.fn().mockResolvedValue({ comments: [], olderCursor: null }),
    getAuthenticatedUser: vi.fn().mockResolvedValue({ login: "me", avatar: null }),
  } satisfies IssueProvider;
}

async function putFollowUp(body: unknown, query = "", issueId = ISSUE_ID) {
  const req = new Request(`http://localhost/api/issues/${issueId}/follow-up${query}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await PUT(req, { params: Promise.resolve({ id: issueId }) });
  return { status: lastStatus, body: lastBody };
}

async function deleteFollowUp(issueId = ISSUE_ID) {
  const req = new Request(`http://localhost/api/issues/${issueId}/follow-up`, { method: "DELETE" });
  await DELETE(req, { params: Promise.resolve({ id: issueId }) });
  return { status: lastStatus, body: lastBody };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  lastStatus = 0;
  lastBody = null;
  mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
  mockGetProviderToken.mockResolvedValue("token-abc");
  mockGetProvider.mockReturnValue(providerStub());
  mockRateLimit.mockResolvedValue(false);
  fakeDb.state.rows.repo.push(repoRow());
  fakeDb.state.rows.issue.push(issueRow());
});

describe("PUT /api/issues/:id/follow-up — authorization and validation", () => {
  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and no database read
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await putFollowUp({ action: "wait" });

    expect(res.status).toBe(401);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies followUpActionSchema
   * @scenario `action` is not one of the three transitions
   * @expectedOutput 400 and nothing written
   */
  it("should return 400 for an unknown action", async () => {
    const res = await putFollowUp({ action: "pause" });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.follow_up).toHaveLength(0);
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies armFollowUp
   * @scenario The issue belongs to another user
   * @expectedOutput 404 and nothing written
   */
  it("should return 404 when arming a foreign issue", async () => {
    fakeDb.state.rows.repo[0] = repoRow({ userId: "user-2" });

    const res = await putFollowUp({ action: "wait" });

    expect(res.status).toBe(404);
    expect(fakeDb.state.rows.follow_up).toHaveLength(0);
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies checkPersistentRateLimit
   * @scenario The user has armed more follow-ups than the window allows
   * @expectedOutput 429 with nothing written: arming is the only transition
   *                 that reads the provider, so it is the only one limited
   */
  it("should return 429 when the arm bucket is exhausted", async () => {
    mockRateLimit.mockResolvedValue(true);

    const res = await putFollowUp({ action: "wait" });

    expect(res.status).toBe(429);
    expect(fakeDb.state.rows.follow_up).toHaveLength(0);
    expect(mockRateLimit).toHaveBeenCalledWith("provider:follow-up:user-1", 30, 900_000);
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies reviewFollowUp
   * @scenario The arm bucket is exhausted, but the user reviews an existing watch
   * @expectedOutput 200: review is a local write, so the arm limit must not
   *                 block the only way to clear an item from the queue
   */
  it("should not rate-limit a review when the arm bucket is exhausted", async () => {
    mockRateLimit.mockResolvedValue(true);
    fakeDb.state.rows.follow_up.push(followUpRow({ reason: "reply" }));

    const res = await putFollowUp({ action: "review" });

    expect(res.status).toBe(200);
    expect(fakeDb.state.rows.follow_up[0].state).toBe("reviewed");
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies stopFollowUp
   * @scenario The arm bucket is exhausted, but the user stops an existing watch
   * @expectedOutput 200. Stop is a local write; blocking it would leave the user
   *                 unable to remove an item from the queue.
   */
  it("should not rate-limit a stop when the arm bucket is exhausted", async () => {
    mockRateLimit.mockResolvedValue(true);
    fakeDb.state.rows.follow_up.push(followUpRow({ reason: "reply" }));

    const res = await putFollowUp({ action: "stop" });

    expect(res.status).toBe(200);
    expect(fakeDb.state.rows.follow_up[0].state).toBe("stopped");
  });
});

describe("PUT /api/issues/:id/follow-up — transitions", () => {
  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies armFollowUp
   * @scenario The user chooses to wait on an open issue
   * @expectedOutput The waiting entry, with a false `due` because nothing has
   *                 happened since the baseline was taken
   */
  it("should arm a follow-up for the wait action", async () => {
    fakeDb.state.rows.provider_identity.push(providerIdentityRow());

    const res = await putFollowUp({ action: "wait" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ issueId: ISSUE_ID, state: "waiting", due: false });
    expect(fakeDb.state.rows.follow_up).toHaveLength(1);
    expect(fakeDb.state.rows.follow_up[0].state).toBe("waiting");
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies reviewFollowUp
   * @scenario The user acknowledges the comment that raised the issue
   * @expectedOutput `state: reviewed` with the baseline moved to that comment
   */
  it("should review with the prompting comment as the new baseline", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ reason: "reply" }));

    const res = await putFollowUp(
      { action: "review" },
      "?commentId=100&commentAt=2026-02-01T10:00:00.000Z"
    );

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const stored = fakeDb.state.rows.follow_up[0];
    expect(stored.state).toBe("reviewed");
    expect(stored.reviewedCommentId).toBe("100");
    expect(stored.lastSeenCommentId).toBe("100");
    expect(stored.lastSeenCommentAt).toEqual(new Date("2026-02-01T10:00:00.000Z"));
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies reviewFollowUp
   * @scenario The user looked and there was nothing to point at
   * @expectedOutput 200 and a review whose baseline moves to the review instant:
   *                 leaving it put would make Review a no-op that lets the same
   *                 comment raise again on the next pass
   */
  it("should review with no comment when none is supplied", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ reason: "reply" }));
    const before = Date.now();

    const res = await putFollowUp({ action: "review" });

    expect(res.status).toBe(200);
    const stored = fakeDb.state.rows.follow_up[0];
    expect(stored.state).toBe("reviewed");
    expect(stored.reason).toBeNull();
    expect(stored.lastSeenCommentId).toBeNull();
    expect((stored.lastSeenCommentAt as Date).getTime()).toBeGreaterThanOrEqual(before);
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies followUpActionSchema
   * @scenario `commentAt` cannot be parsed as a date
   * @expectedOutput 400 with the baseline untouched: moving it to null would
   *                 widen the window rather than narrow it
   */
  it("should return 400 for an invalid commentAt and change nothing", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ reason: "reply", lastSeenCommentId: "90" }));

    const res = await putFollowUp({ action: "review" }, "?commentId=100&commentAt=not-a-date");

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("commentAt");
    expect(fakeDb.state.rows.follow_up[0].state).toBe("waiting");
    expect(fakeDb.state.rows.follow_up[0].lastSeenCommentId).toBe("90");
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies reviewFollowUp
   * @scenario Nothing is being followed on the issue
   * @expectedOutput 404 rather than a silent success that changed no row
   */
  it("should return 404 when reviewing an issue that is not followed", async () => {
    const res = await putFollowUp({ action: "review" });

    expect(res.status).toBe(404);
    expect(fakeDb.state.rows.follow_up).toHaveLength(0);
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies stopFollowUp
   * @scenario The user abandons tracking
   * @expectedOutput `state: stopped` and the reason cleared
   */
  it("should stop a follow-up for the stop action", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow({ reason: "reply" }));

    const res = await putFollowUp({ action: "stop" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fakeDb.state.rows.follow_up[0].state).toBe("stopped");
    expect(fakeDb.state.rows.follow_up[0].reason).toBeNull();
  });

  /**
   * @target PUT /api/issues/:id/follow-up
   * @dependencies stopFollowUp
   * @scenario Nothing is being followed on the issue
   * @expectedOutput 404
   */
  it("should return 404 when stopping an issue that is not followed", async () => {
    const res = await putFollowUp({ action: "stop" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/issues/:id/follow-up", () => {
  /**
   * @target DELETE /api/issues/:id/follow-up
   * @dependencies stopFollowUp
   * @scenario A client that only has the issue stops the watch
   * @expectedOutput The follow-up is stopped
   */
  it("should stop the follow-up", async () => {
    fakeDb.state.rows.follow_up.push(followUpRow());

    const res = await deleteFollowUp();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fakeDb.state.rows.follow_up[0].state).toBe("stopped");
  });

  /**
   * @target DELETE /api/issues/:id/follow-up
   * @dependencies stopFollowUp
   * @scenario Nothing is being followed
   * @expectedOutput 404
   */
  it("should return 404 when the issue is not followed", async () => {
    const res = await deleteFollowUp();

    expect(res.status).toBe(404);
  });

  /**
   * @target DELETE /api/issues/:id/follow-up
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await deleteFollowUp();

    expect(res.status).toBe(401);
  });
});
