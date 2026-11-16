/**
 * @module tests/unit/app/api/issues/draft
 *
 * Unit tests for `GET`/`PUT`/`DELETE /api/issues/[id]/draft`.
 *
 * The draft is the user's work, so the route's job is to never lose it and
 * never let a stale writer replace it. `PUT` is conditional on the version the
 * editor last read: a create with `expectedVersion: 0` on an existing draft is a
 * 409, and so is an update whose version has moved on. `DELETE` exists so
 * discarding is possible instead of the text resurrecting on the next open.
 *
 * Both writes are gated on the same ownership join as the send path, so a
 * foreign issue is a 404 rather than a draft written against somebody else's
 * issue id.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE, GET, PUT } from "@/app/api/issues/[id]/draft/route";
import { auth } from "@/auth";
import { ISSUE_ID, fakeDb, issueRow, replyDraftRow, repoRow } from "../../../support/fake-db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/query", async () => {
  const { fakeDb } = await import("../../../support/fake-db");
  return { typedDb: fakeDb.typedDb };
});
vi.mock("@/lib/logger", () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockAuth = vi.mocked(auth);

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

const URL_FOR_ISSUE = `http://localhost/api/issues/${ISSUE_ID}/draft`;

async function getDraft(issueId = ISSUE_ID) {
  await GET(new Request(URL_FOR_ISSUE), { params: Promise.resolve({ id: issueId }) });
  return { status: lastStatus, body: lastBody };
}

async function putDraft(body: unknown, issueId = ISSUE_ID) {
  const req = new Request(URL_FOR_ISSUE, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await PUT(req, { params: Promise.resolve({ id: issueId }) });
  return { status: lastStatus, body: lastBody };
}

async function deleteDraft(issueId = ISSUE_ID) {
  const req = new Request(URL_FOR_ISSUE, { method: "DELETE" });
  await DELETE(req, { params: Promise.resolve({ id: issueId }) });
  return { status: lastStatus, body: lastBody };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  lastStatus = 0;
  lastBody = null;
  mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
  fakeDb.state.rows.repo.push(repoRow());
  fakeDb.state.rows.issue.push(issueRow());
});

describe("GET /api/issues/:id/draft", () => {
  /**
   * @target GET /api/issues/:id/draft
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and no database read
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await getDraft();

    expect(res.status).toBe(401);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target GET /api/issues/:id/draft
   * @dependencies findDraft
   * @scenario Nothing has been written yet
   * @expectedOutput 200 with a literal `null`, so the composer can distinguish
   *                 "no draft" from an error
   */
  it("should return null when no draft exists", async () => {
    const res = await getDraft();

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  /**
   * @target GET /api/issues/:id/draft
   * @dependencies findDraft
   * @scenario A stored draft
   * @expectedOutput The draft with both instants as ISO strings
   */
  it("should return the stored draft", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow());

    const res = await getDraft();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: "55555555-5555-4555-8555-555555555555",
      body: "Thanks for the report — can you share the stack trace?",
      version: 1,
      sendAttemptedAt: null,
      updatedAt: "2026-01-05T00:00:00.000Z",
    });
  });

  /**
   * @target GET /api/issues/:id/draft
   * @dependencies loadReplyTarget
   * @scenario The issue lives in another user's repository
   * @expectedOutput 404, not the other user's draft
   */
  it("should return 404 for a foreign issue", async () => {
    fakeDb.state.rows.repo[0] = repoRow({ userId: "user-2" });
    fakeDb.state.rows.reply_draft.push(replyDraftRow());

    const res = await getDraft();

    expect(res.status).toBe(404);
  });
});

describe("PUT /api/issues/:id/draft", () => {
  /**
   * @target PUT /api/issues/:id/draft
   * @dependencies saveDraft
   * @scenario The first save on an issue with no draft
   * @expectedOutput The created draft at version 1
   */
  it("should create a draft from expectedVersion 0", async () => {
    const res = await putDraft({ body: "First pass", expectedVersion: 0 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ body: "First pass", version: 1 });
    expect(fakeDb.state.rows.reply_draft).toHaveLength(1);
  });

  /**
   * @target PUT /api/issues/:id/draft
   * @dependencies saveDraft
   * @scenario The editor holds the current version and saves an edit
   * @expectedOutput The updated draft at version 2
   */
  it("should update a draft from its current version", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ version: 1, body: "First pass" }));

    const res = await putDraft({ body: "Edited", expectedVersion: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ body: "Edited", version: 2 });
  });

  /**
   * @target PUT /api/issues/:id/draft
   * @dependencies saveDraft
   * @scenario A second tab creates a draft that already exists
   * @expectedOutput 409 and the stored body untouched
   */
  it("should return 409 when a create races an existing draft", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ body: "Original" }));

    const res = await putDraft({ body: "Overwrite", expectedVersion: 0 });

    expect(res.status).toBe(409);
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("Original");
  });

  /**
   * @target PUT /api/issues/:id/draft
   * @dependencies saveDraft
   * @scenario The editor's version is behind the stored one
   * @expectedOutput 409 and the newer text kept, so a stale tab cannot lose work
   */
  it("should return 409 for a stale version and keep the newer text", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ version: 5, body: "Newer text" }));

    const res = await putDraft({ body: "Stale text", expectedVersion: 3 });

    expect(res.status).toBe(409);
    expect(fakeDb.state.rows.reply_draft[0].body).toBe("Newer text");
    expect(fakeDb.state.rows.reply_draft[0].version).toBe(5);
  });

  /**
   * @target PUT /api/issues/:id/draft
   * @dependencies saveDraftSchema
   * @scenario `expectedVersion` is absent
   * @expectedOutput 400 and nothing written
   */
  it("should return 400 without expectedVersion", async () => {
    const res = await putDraft({ body: "Text" });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.reply_draft).toHaveLength(0);
  });

  /**
   * @target PUT /api/issues/:id/draft
   * @dependencies loadReplyTarget
   * @scenario The issue belongs to another user
   * @expectedOutput 404 and nothing written
   */
  it("should return 404 for a foreign issue", async () => {
    fakeDb.state.rows.repo[0] = repoRow({ userId: "user-2" });

    const res = await putDraft({ body: "Text", expectedVersion: 0 });

    expect(res.status).toBe(404);
    expect(fakeDb.state.rows.reply_draft).toHaveLength(0);
  });
});

describe("DELETE /api/issues/:id/draft", () => {
  /**
   * @target DELETE /api/issues/:id/draft
   * @dependencies clearDraft
   * @scenario The user discards their draft
   * @expectedOutput `{ ok: true }` and the row removed
   */
  it("should remove the draft", async () => {
    fakeDb.state.rows.reply_draft.push(replyDraftRow());

    const res = await deleteDraft();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fakeDb.state.rows.reply_draft).toHaveLength(0);
  });

  /**
   * @target DELETE /api/issues/:id/draft
   * @dependencies clearDraft
   * @scenario There is nothing to discard
   * @expectedOutput 200 and `{ ok: true }`: discarding twice is not an error
   */
  it("should succeed when there is no draft to remove", async () => {
    const res = await deleteDraft();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  /**
   * @target DELETE /api/issues/:id/draft
   * @dependencies loadReplyTarget
   * @scenario The issue belongs to another user
   * @expectedOutput 404 and the other user's draft survives
   */
  it("should return 404 for a foreign issue and remove nothing", async () => {
    fakeDb.state.rows.repo[0] = repoRow({ userId: "user-2" });
    fakeDb.state.rows.reply_draft.push(replyDraftRow({ userId: "user-2" }));

    const res = await deleteDraft();

    expect(res.status).toBe(404);
    expect(fakeDb.state.rows.reply_draft).toHaveLength(1);
  });
});
