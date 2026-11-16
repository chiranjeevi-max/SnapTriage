/**
 * @module tests/unit/app/api/presets/route
 *
 * Unit tests for `GET`/`POST /api/presets`.
 *
 * The contract these tests hold the route to:
 *
 * - No session means 401 before any database or validation work.
 * - A preset can only be created for a repository the caller owns, and a repo
 *   belonging to somebody else is 404 rather than 403.
 * - A preset that does nothing is rejected, as is one that lists the same value
 *   twice in one field, because either would produce a silent no-op keystroke.
 * - The per-repository quota is reported, never silently truncated.
 * - The list re-validates stored JSON, so a stale row is omitted rather than
 *   returned half-parsed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET, POST } from "@/app/api/presets/route";
import { auth } from "@/auth";
import { PRESET_LIMIT_PER_REPO } from "@/features/presets/types";
import { fakeDb, presetRow, repoRow } from "../../../support/fake-db";

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

const REPO_ID = "123e4567-e89b-12d3-a456-426614174000";

async function listPresets(repoId: string | null = REPO_ID) {
  const url = new URL("http://localhost/api/presets");
  if (repoId) url.searchParams.set("repoId", repoId);
  await GET(new Request(url));
  return { status: lastStatus, body: lastBody };
}

async function createPreset(body: unknown) {
  const req = new Request("http://localhost/api/presets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await POST(req);
  return { status: lastStatus, body: lastBody };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  lastStatus = 0;
  lastBody = null;
  mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
});

describe("GET /api/presets", () => {
  /**
   * @target GET /api/presets
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and no database read
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await listPresets();

    expect(res.status).toBe(401);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target GET /api/presets
   * @dependencies auth, findOwnedRepo
   * @scenario The repo belongs to another user
   * @expectedOutput 404, not 403: the caller learns nothing about its existence
   */
  it("should return 404 for a repository the user does not own", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID, userId: "user-2" }));

    const res = await listPresets();

    expect(res.status).toBe(404);
  });

  /**
   * @target GET /api/presets
   * @dependencies auth
   * @scenario No repoId query param
   * @expectedOutput 400
   */
  it("should return 400 without a repoId", async () => {
    const res = await listPresets(null);

    expect(res.status).toBe(400);
  });

  /**
   * @target GET /api/presets
   * @dependencies listPresets, presetActionsSchema
   * @scenario One stored row is valid and another carries actions that no
   *           longer validate
   * @expectedOutput Only the valid preset is returned, with `actions` parsed
   */
  it("should return parsed actions and skip a stale row", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID }));
    fakeDb.state.rows.triage_preset.push(
      presetRow({
        id: "preset-ok",
        repoId: REPO_ID,
        name: "Confirmed bug",
        actions: { priority: 1, labels: { add: ["bug"] } },
      }),
      presetRow({ id: "preset-stale", repoId: REPO_ID, actions: { state: "closed" } })
    );

    const res = await listPresets();

    expect(res.status).toBe(200);
    const presets = res.body as Array<{ id: string; actions: unknown }>;
    expect(presets).toHaveLength(1);
    expect(presets[0].id).toBe("preset-ok");
    expect(presets[0].actions).toEqual({ priority: 1, labels: { add: ["bug"] } });
  });

  /**
   * @target GET /api/presets
   * @dependencies listPresets
   * @scenario The repo is owned but has no presets yet
   * @expectedOutput 200 with an empty array
   */
  it("should return an empty array for a repo with no presets", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID }));

    const res = await listPresets();

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

describe("POST /api/presets", () => {
  /**
   * @target POST /api/presets
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await createPreset({ repoId: REPO_ID, name: "x", actions: { priority: 1 } });

    expect(res.status).toBe(401);
    // Nothing touched the database. A 401 that still ran an insert would leak a
    // row for a caller who is not signed in.
    expect(fakeDb.state.log).toHaveLength(0);
    expect(fakeDb.state.rows.triage_preset).toHaveLength(0);
  });

  /**
   * @target POST /api/presets
   * @dependencies createPresetSchema
   * @scenario `actions` carries nothing a preset can do
   * @expectedOutput 400 and nothing stored
   */
  it("should reject a preset with no actions", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID }));

    const res = await createPreset({ repoId: REPO_ID, name: "Empty", actions: {} });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.triage_preset).toHaveLength(0);
  });

  /**
   * @target POST /api/presets
   * @dependencies createPresetSchema
   * @scenario Snooze, dismiss, and state are not preset actions
   * @expectedOutput 400; a preset cannot close an issue behind the preview
   */
  it("should reject actions a preset may not carry", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID }));

    const res = await createPreset({
      repoId: REPO_ID,
      name: "Closer",
      actions: { state: "closed" },
    });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.triage_preset).toHaveLength(0);
  });

  /**
   * @target POST /api/presets
   * @dependencies createPresetSchema
   * @scenario The same label appears twice in one field
   * @expectedOutput 400 and nothing stored
   */
  it("should reject a duplicate label inside one field", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID }));

    const res = await createPreset({
      repoId: REPO_ID,
      name: "Doubled",
      actions: { labels: { add: ["bug", "BUG"] } },
    });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.triage_preset).toHaveLength(0);
  });

  /**
   * @target POST /api/presets
   * @dependencies findOwnedRepo
   * @scenario The repo belongs to another user
   * @expectedOutput 404 and nothing stored
   */
  it("should return 404 when creating against a repo the user does not own", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID, userId: "user-2" }));

    const res = await createPreset({
      repoId: REPO_ID,
      name: "Not mine",
      actions: { priority: 1 },
    });

    expect(res.status).toBe(404);
    expect(fakeDb.state.rows.triage_preset).toHaveLength(0);
  });

  /**
   * @target POST /api/presets
   * @dependencies countPresets, PRESET_LIMIT_PER_REPO
   * @scenario The user already keeps the maximum number of presets for the repo
   * @expectedOutput 409 with an explainable message, and nothing stored: a quota
   *                 is reported, never enforced by silently dropping a save
   */
  it("should return 409 with a quota message when the limit is reached", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID }));
    for (let index = 0; index < PRESET_LIMIT_PER_REPO; index++) {
      fakeDb.state.rows.triage_preset.push(presetRow({ id: `preset-${index}`, repoId: REPO_ID }));
    }

    const res = await createPreset({ repoId: REPO_ID, name: "One more", actions: { priority: 1 } });

    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toContain(String(PRESET_LIMIT_PER_REPO));
    expect(fakeDb.state.rows.triage_preset).toHaveLength(PRESET_LIMIT_PER_REPO);
  });

  /**
   * @target POST /api/presets
   * @dependencies providerLimitViolation, providerLimits
   * @scenario A label is longer than the repository's provider accepts, while
   *           still within the schema's fixed bound
   * @expectedOutput 400 naming the real limit, and nothing stored: a preset that
   *                 could never be applied must not be storable
   */
  it("should reject a label longer than the provider allows", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID, provider: "github" }));

    // GitHub caps label names at 50 characters; the schema allows 256.
    const res = await createPreset({
      repoId: REPO_ID,
      name: "Too long",
      actions: { labels: { add: ["x".repeat(51)] } },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("50");
    expect(fakeDb.state.rows.triage_preset).toHaveLength(0);
  });

  /**
   * @target POST /api/presets
   * @dependencies providerLimitViolation, providerLimits
   * @scenario The same 51-character label on a GitLab repository, which allows 255
   * @expectedOutput 201: the limit that applies is the repository's own, not the
   *                 strictest one the app supports
   */
  it("should accept that same label on a provider that allows it", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID, provider: "gitlab" }));

    const res = await createPreset({
      repoId: REPO_ID,
      name: "Long but legal",
      actions: { labels: { add: ["x".repeat(51)] } },
    });

    expect(res.status).toBe(201);
    expect(fakeDb.state.rows.triage_preset).toHaveLength(1);
  });

  /**
   * @target POST /api/presets
   * @dependencies providerLimitViolation, providerLimits
   * @scenario An assignee login longer than GitHub accepts
   * @expectedOutput 400 naming the login limit, and nothing stored
   */
  it("should reject a login longer than the provider allows", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID, provider: "github" }));

    const res = await createPreset({
      repoId: REPO_ID,
      name: "Too long login",
      actions: { assignees: { add: ["u".repeat(40)] } },
    });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("39");
    expect(fakeDb.state.rows.triage_preset).toHaveLength(0);
  });

  /**
   * @target POST /api/presets
   * @dependencies createPreset
   * @scenario A valid preset for an owned repo
   * @expectedOutput 201 with the created preset, whose actions are parsed
   */
  it("should create a preset and return it with 201", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: REPO_ID }));

    const res = await createPreset({
      repoId: REPO_ID,
      name: "Confirmed bug",
      actions: { priority: 1, labels: { add: ["bug"] }, assignees: { add: ["jo"] } },
    });

    expect(res.status).toBe(201);
    const preset = res.body as { id: string; name: string; repoId: string; actions: unknown };
    expect(preset.name).toBe("Confirmed bug");
    expect(preset.repoId).toBe(REPO_ID);
    expect(preset.actions).toEqual({
      priority: 1,
      labels: { add: ["bug"] },
      assignees: { add: ["jo"] },
    });
    expect(fakeDb.state.rows.triage_preset).toHaveLength(1);
  });
});
