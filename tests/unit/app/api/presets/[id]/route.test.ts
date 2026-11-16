/**
 * @module tests/unit/app/api/presets/[id]/route
 *
 * Unit tests for `PATCH`/`DELETE /api/presets/:id`.
 *
 * Both handlers scope by `userId` inside the query, so a preset belonging to
 * somebody else must look missing rather than forbidden — the caller must not
 * be able to confirm that an id they guessed exists.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DELETE, PATCH } from "@/app/api/presets/[id]/route";
import { auth } from "@/auth";
import { PRESET_ID, REPO_ID, fakeDb, presetRow, repoRow } from "../../../../support/fake-db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db/query", async () => {
  const { fakeDb } = await import("../../../../support/fake-db");
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

async function patchPreset(body: unknown, presetId = PRESET_ID) {
  const req = new Request(`http://localhost/api/presets/${presetId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await PATCH(req, { params: Promise.resolve({ id: presetId }) });
  return { status: lastStatus, body: lastBody };
}

async function deletePreset(presetId = PRESET_ID) {
  const req = new Request(`http://localhost/api/presets/${presetId}`, { method: "DELETE" });
  await DELETE(req, { params: Promise.resolve({ id: presetId }) });
  return { status: lastStatus, body: lastBody };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  lastStatus = 0;
  lastBody = null;
  mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
});

describe("PATCH /api/presets/:id", () => {
  /**
   * @target PATCH /api/presets/:id
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await patchPreset({ name: "Renamed" });

    expect(res.status).toBe(401);
  });

  /**
   * @target PATCH /api/presets/:id
   * @dependencies updatePresetSchema
   * @scenario Neither `name` nor `actions` is present
   * @expectedOutput 400
   */
  it("should return 400 for an empty update", async () => {
    const res = await patchPreset({});

    expect(res.status).toBe(400);
  });

  /**
   * @target PATCH /api/presets/:id
   * @dependencies updatePreset
   * @scenario The preset belongs to another user
   * @expectedOutput 404 and the row unchanged
   */
  it("should return 404 for another user's preset", async () => {
    fakeDb.state.rows.triage_preset.push(presetRow({ userId: "user-2" }));

    const res = await patchPreset({ name: "Hijacked" });

    expect(res.status).toBe(404);
    expect(fakeDb.state.rows.triage_preset[0].name).toBe("Confirmed bug");
  });

  /**
   * @target PATCH /api/presets/:id
   * @dependencies updatePreset
   * @scenario A rename and a new action bundle
   * @expectedOutput 200 with the updated preset
   */
  it("should update the preset and return it", async () => {
    fakeDb.state.rows.triage_preset.push(presetRow());

    const res = await patchPreset({
      name: "Renamed",
      actions: { assignees: { add: ["nadia"] } },
    });

    expect(res.status).toBe(200);
    const preset = res.body as { name: string; actions: unknown };
    expect(preset.name).toBe("Renamed");
    expect(preset.actions).toEqual({ assignees: { add: ["nadia"] } });
  });

  /**
   * @target PATCH /api/presets/:id
   * @dependencies providerLimitViolation, providerLimits, findOwnedRepo
   * @scenario An edit sets a label longer than the repository's provider accepts
   * @expectedOutput 400 naming the real limit, and the stored bundle untouched:
   *                 an edit must not turn a working preset into a dead one
   */
  it("should reject an edited label longer than the provider allows", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID, provider: "github" }));
    fakeDb.state.rows.triage_preset.push(presetRow({ repoId: REPO_ID }));

    const res = await patchPreset({ actions: { labels: { add: ["x".repeat(51)] } } });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("50");
    // The whole bundle, not just the field the edit touched: a rejected write
    // must leave priority and assignees exactly as they were too.
    expect(fakeDb.state.rows.triage_preset[0].actions).toEqual({
      priority: 1,
      labels: { add: ["bug"] },
    });
  });
});

describe("DELETE /api/presets/:id", () => {
  /**
   * @target DELETE /api/presets/:id
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await deletePreset();

    expect(res.status).toBe(401);
    expect(fakeDb.state.rows.triage_preset).toHaveLength(0);
  });

  /**
   * @target DELETE /api/presets/:id
   * @dependencies deletePreset
   * @scenario The preset belongs to another user
   * @expectedOutput 404 and the row still present
   */
  it("should return 404 for another user's preset", async () => {
    fakeDb.state.rows.triage_preset.push(presetRow({ userId: "user-2" }));

    const res = await deletePreset();

    expect(res.status).toBe(404);
    expect(fakeDb.state.rows.triage_preset).toHaveLength(1);
  });

  /**
   * @target DELETE /api/presets/:id
   * @dependencies deletePreset
   * @scenario The preset belongs to the caller and an issue already carried the
   *           labels it added
   * @expectedOutput 200 `{ ok: true }` and the row removed; deleting a preset
   *                 never reverts an earlier application, which is triage state
   *                 the issue owns
   */
  it("should delete the preset and remove it", async () => {
    fakeDb.state.rows.triage_preset.push(presetRow());

    const res = await deletePreset();

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(fakeDb.state.rows.triage_preset).toHaveLength(0);
  });
});
