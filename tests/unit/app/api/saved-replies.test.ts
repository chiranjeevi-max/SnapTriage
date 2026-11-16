/**
 * @module tests/unit/app/api/saved-replies
 *
 * Unit tests for `GET`/`POST /api/saved-replies` and
 * `PATCH`/`DELETE /api/saved-replies/[id]`.
 *
 * A template is prose the user will paste into a public thread, so two rules
 * matter more than the CRUD shape:
 *
 * - **Ownership is part of the write predicate, not a check before it.** A
 *   guessed id cannot be turned into a cross-user edit or delete, and the answer
 *   is 404 so the caller learns nothing about the other user's rows.
 * - **The quota is reported, never enforced by silently dropping a save.** At
 *   100 templates a save is a 409 the user can act on; a 201 that stored nothing
 *   would let them believe the text was kept.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/saved-replies/route";
import { DELETE, PATCH } from "@/app/api/saved-replies/[id]/route";
import { auth } from "@/auth";
import { SAVED_REPLY_ID, fakeDb, savedReplyRow } from "../../support/fake-db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/query", async () => {
  const { fakeDb } = await import("../../support/fake-db");
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

/** The per-user template cap the route enforces. */
const SAVED_REPLY_LIMIT = 100;

async function listSavedReplies() {
  await GET();
  return { status: lastStatus, body: lastBody };
}

async function createSavedReply(body: unknown) {
  const req = new Request("http://localhost/api/saved-replies", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await POST(req);
  return { status: lastStatus, body: lastBody };
}

async function patchSavedReply(body: unknown, id = SAVED_REPLY_ID) {
  const req = new Request(`http://localhost/api/saved-replies/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await PATCH(req, { params: Promise.resolve({ id }) });
  return { status: lastStatus, body: lastBody };
}

async function deleteSavedReply(id = SAVED_REPLY_ID) {
  const req = new Request(`http://localhost/api/saved-replies/${id}`, { method: "DELETE" });
  await DELETE(req, { params: Promise.resolve({ id }) });
  return { status: lastStatus, body: lastBody };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  lastStatus = 0;
  lastBody = null;
  mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
});

describe("GET /api/saved-replies", () => {
  /**
   * @target GET /api/saved-replies
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and no database read
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await listSavedReplies();

    expect(res.status).toBe(401);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target GET /api/saved-replies
   * @dependencies typedDb.select(saved_reply)
   * @scenario The user has no templates yet
   * @expectedOutput 200 with an empty array
   */
  it("should return an empty array when nothing is saved", async () => {
    const res = await listSavedReplies();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  /**
   * @target GET /api/saved-replies
   * @dependencies typedDb.select(saved_reply)
   * @scenario The user has one template
   * @expectedOutput Its fields with both instants as ISO strings
   */
  it("should return templates with ISO instants", async () => {
    fakeDb.state.rows.saved_reply.push(savedReplyRow());

    const res = await listSavedReplies();

    expect(res.body).toEqual([
      {
        id: SAVED_REPLY_ID,
        name: "Need more info",
        body: "Could you share the version and a minimal reproduction?",
        createdAt: "2026-01-06T00:00:00.000Z",
        updatedAt: "2026-01-06T00:00:00.000Z",
      },
    ]);
  });

  /**
   * @target GET /api/saved-replies
   * @dependencies typedDb.select(saved_reply)
   * @scenario Another user also has templates
   * @expectedOutput Only the caller's: a template is personal prose
   */
  it("should not list another user's templates", async () => {
    fakeDb.state.rows.saved_reply.push(savedReplyRow({ userId: "user-2" }));

    const res = await listSavedReplies();

    expect(res.body).toEqual([]);
  });
});

describe("POST /api/saved-replies", () => {
  /**
   * @target POST /api/saved-replies
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and nothing stored
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await createSavedReply({ name: "x", body: "y" });

    expect(res.status).toBe(401);
    expect(fakeDb.state.rows.saved_reply).toHaveLength(0);
  });

  /**
   * @target POST /api/saved-replies
   * @dependencies createSavedReplySchema
   * @scenario A valid template
   * @expectedOutput 201 with the stored row and ISO instants
   */
  it("should create a template and return it with 201", async () => {
    const res = await createSavedReply({ name: "Need more info", body: "Please share a repro." });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: "Need more info", body: "Please share a repro." });
    expect((res.body as { id: string }).id).toEqual(expect.any(String));
    // Both instants are part of the documented contract, and `expect.any(String)`
    // would accept a Date object's string form or an empty value just as happily.
    const created = res.body as { createdAt: string; updatedAt: string };
    expect(created.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(created.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    expect(fakeDb.state.rows.saved_reply).toHaveLength(1);
    expect(fakeDb.state.rows.saved_reply[0].userId).toBe("user-1");
  });

  /**
   * @target POST /api/saved-replies
   * @dependencies createSavedReplySchema
   * @scenario The name is missing or blank
   * @expectedOutput 400 and nothing stored
   */
  it("should reject a blank name", async () => {
    const res = await createSavedReply({ name: "   ", body: "Please share a repro." });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.saved_reply).toHaveLength(0);
  });

  /**
   * @target POST /api/saved-replies
   * @dependencies createSavedReplySchema
   * @scenario The body is missing
   * @expectedOutput 400 rather than an unhandled throw
   */
  it("should reject a missing body", async () => {
    const res = await createSavedReply({ name: "Only a name" });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.saved_reply).toHaveLength(0);
  });

  /**
   * @target POST /api/saved-replies
   * @dependencies createSavedReplySchema
   * @scenario The name is longer than the schema allows
   * @expectedOutput 400 and nothing stored
   */
  it("should reject a name over 80 characters", async () => {
    const res = await createSavedReply({ name: "n".repeat(81), body: "Text" });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.saved_reply).toHaveLength(0);
  });

  /**
   * @target POST /api/saved-replies
   * @dependencies SAVED_REPLY_LIMIT
   * @scenario The user already keeps the maximum number of templates
   * @expectedOutput 409 naming the limit, and nothing stored
   */
  it("should return 409 with a quota message at 100 templates", async () => {
    for (let index = 0; index < SAVED_REPLY_LIMIT; index++) {
      fakeDb.state.rows.saved_reply.push(savedReplyRow({ id: `saved-${index}` }));
    }

    const res = await createSavedReply({ name: "One more", body: "Text" });

    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toContain(String(SAVED_REPLY_LIMIT));
    expect(fakeDb.state.rows.saved_reply).toHaveLength(SAVED_REPLY_LIMIT);
  });

  /**
   * @target POST /api/saved-replies
   * @dependencies SAVED_REPLY_LIMIT
   * @scenario Another user holds the maximum, and this user holds none
   * @expectedOutput 201: the quota is per user, so a neighbour's templates
   *                 cannot block a save
   */
  it("should not count another user's templates against the quota", async () => {
    for (let index = 0; index < SAVED_REPLY_LIMIT; index++) {
      fakeDb.state.rows.saved_reply.push(savedReplyRow({ id: `their-${index}`, userId: "user-2" }));
    }

    const res = await createSavedReply({ name: "Fine", body: "Text" });

    expect(res.status).toBe(201);
    expect(fakeDb.state.rows.saved_reply).toHaveLength(SAVED_REPLY_LIMIT + 1);
  });
});

describe("PATCH /api/saved-replies/:id", () => {
  /**
   * @target PATCH /api/saved-replies/:id
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and nothing changed
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    fakeDb.state.rows.saved_reply.push(savedReplyRow());

    const res = await patchSavedReply({ name: "Renamed" });

    expect(res.status).toBe(401);
    expect(fakeDb.state.rows.saved_reply[0].name).toBe("Need more info");
  });

  /**
   * @target PATCH /api/saved-replies/:id
   * @dependencies updateSavedReplySchema
   * @scenario The owner renames a template
   * @expectedOutput 200 with the renamed row, its body untouched
   */
  it("should rename a template its owner owns", async () => {
    fakeDb.state.rows.saved_reply.push(savedReplyRow());

    const res = await patchSavedReply({ name: "Repro request" });

    expect(res.status).toBe(200);
    expect((res.body as { name: string }).name).toBe("Repro request");
    expect(fakeDb.state.rows.saved_reply[0].body).toBe(
      "Could you share the version and a minimal reproduction?"
    );
  });

  /**
   * @target PATCH /api/saved-replies/:id
   * @dependencies updateSavedReplySchema
   * @scenario The owner rewrites the body
   * @expectedOutput 200 with the new text and the name untouched
   */
  it("should rewrite the body of a template", async () => {
    fakeDb.state.rows.saved_reply.push(savedReplyRow());

    const res = await patchSavedReply({ body: "New text" });

    expect(res.status).toBe(200);
    expect(fakeDb.state.rows.saved_reply[0].body).toBe("New text");
    expect(fakeDb.state.rows.saved_reply[0].name).toBe("Need more info");
  });

  /**
   * @target PATCH /api/saved-replies/:id
   * @dependencies updateSavedReplySchema
   * @scenario The body carries neither field
   * @expectedOutput 400: an update that changes nothing is a client bug, not a no-op
   */
  it("should reject an empty update", async () => {
    fakeDb.state.rows.saved_reply.push(savedReplyRow());

    const res = await patchSavedReply({});

    expect(res.status).toBe(400);
  });

  /**
   * @target PATCH /api/saved-replies/:id
   * @dependencies updateSavedReplySchema
   * @scenario The body carries a field the schema does not know
   * @expectedOutput 400, since the schema is strict about extra keys
   */
  it("should reject an unknown field", async () => {
    fakeDb.state.rows.saved_reply.push(savedReplyRow());

    const res = await patchSavedReply({ name: "Renamed", userId: "user-2" });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.saved_reply[0].userId).toBe("user-1");
  });

  /**
   * @target PATCH /api/saved-replies/:id
   * @dependencies typedDb.update(saved_reply)
   * @scenario The template belongs to another user
   * @expectedOutput 404 and the row unchanged: ownership is in the predicate
   */
  it("should return 404 for another user's template", async () => {
    fakeDb.state.rows.saved_reply.push(savedReplyRow({ userId: "user-2" }));

    const res = await patchSavedReply({ name: "Hijacked" });

    expect(res.status).toBe(404);
    expect(fakeDb.state.rows.saved_reply[0].name).toBe("Need more info");
  });

  /**
   * @target PATCH /api/saved-replies/:id
   * @dependencies typedDb.update(saved_reply)
   * @scenario The id does not exist
   * @expectedOutput 404
   */
  it("should return 404 for a template that does not exist", async () => {
    const res = await patchSavedReply({ name: "Nowhere" });

    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/saved-replies/:id", () => {
  /**
   * @target DELETE /api/saved-replies/:id
   * @dependencies typedDb.delete(saved_reply)
   * @scenario The owner removes a template
   * @expectedOutput `{ ok: true }` and the row gone
   */
  it("should delete a template its owner owns", async () => {
    fakeDb.state.rows.saved_reply.push(savedReplyRow());

    const res = await deleteSavedReply();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fakeDb.state.rows.saved_reply).toHaveLength(0);
  });

  /**
   * @target DELETE /api/saved-replies/:id
   * @dependencies typedDb.delete(saved_reply)
   * @scenario The template belongs to another user
   * @expectedOutput 404 and the row survives
   */
  it("should return 404 for another user's template and keep it", async () => {
    fakeDb.state.rows.saved_reply.push(savedReplyRow({ userId: "user-2" }));

    const res = await deleteSavedReply();

    expect(res.status).toBe(404);
    expect(fakeDb.state.rows.saved_reply).toHaveLength(1);
  });

  /**
   * @target DELETE /api/saved-replies/:id
   * @dependencies typedDb.delete(saved_reply)
   * @scenario The id was already deleted
   * @expectedOutput 404, so a stale client learns it is stale
   */
  it("should return 404 when the template was already deleted", async () => {
    expect((await deleteSavedReply()).status).toBe(404);
  });

  /**
   * @target DELETE /api/saved-replies/:id
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and the row survives
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);
    fakeDb.state.rows.saved_reply.push(savedReplyRow());

    const res = await deleteSavedReply();

    expect(res.status).toBe(401);
    expect(fakeDb.state.rows.saved_reply).toHaveLength(1);
  });
});
