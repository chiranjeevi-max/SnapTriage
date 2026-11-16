/**
 * @module tests/unit/app/api/issues/apply-preset
 *
 * Unit tests for `POST /api/issues/[id]/apply-preset`, the route the whole
 * refactor exists for.
 *
 * What is being held in place:
 *
 * - **The client never sends the actions.** The route reads the stored preset
 *   and re-derives ownership, repo match, and sync mode itself, so a forged or
 *   stale bundle cannot be applied.
 * - **A no-op writes nothing.** Re-applying a satisfied preset makes no
 *   provider call and commits no triage row.
 * - **The provider comes first.** On a live write the provider is called
 *   *before* `triage_state` or the cached issue row is touched. The ordered log
 *   makes that an assertion rather than an assumption.
 * - **A failed provider call commits nothing.** This is the regression: the
 *   inline PATCH used to persist priority before the provider call, so a
 *   rejected label left the priority applied.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/issues/[id]/apply-preset/route";
import { auth } from "@/auth";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import type { IssueProvider } from "@/lib/provider-interface";
import {
  ISSUE_ID,
  OTHER_REPO_ID,
  PRESET_ID,
  REPO_ID,
  fakeDb,
  issueRow,
  presetRow,
  repoRow,
  triageRow,
} from "../../../support/fake-db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/features/auth/get-provider-token", () => ({ getProviderToken: vi.fn() }));
vi.mock("@/lib/providers", () => ({ getProvider: vi.fn() }));
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

/** A provider stub whose `updateIssue` is the only behaviour under test. */
function providerStub(updateIssue: () => Promise<void>) {
  return {
    updateIssue: vi.fn(updateIssue),
    fetchIssues: vi.fn().mockResolvedValue([]),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
  } satisfies IssueProvider;
}

async function applyPreset(body: unknown, issueId = ISSUE_ID) {
  const req = new Request(`http://localhost/api/issues/${issueId}/apply-preset`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await POST(req, { params: Promise.resolve({ id: issueId }) });
  return { status: lastStatus, body: lastBody };
}

/**
 * Which local writes happened, in order.
 *
 * `db:` entries come from the fake database's operation log; `provider:` is
 * appended by the provider stub. Interleaving them is what turns "the provider
 * ran and so did a write" into "the provider ran first".
 */
function operations(): string[] {
  return fakeDb.state.log;
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  lastStatus = 0;
  lastBody = null;
  mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
  mockGetProviderToken.mockResolvedValue("token-abc");
  mockGetProvider.mockReturnValue(providerStub(async () => {}));
});

describe("POST /api/issues/:id/apply-preset — authorization", () => {
  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 and no database read
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(401);
    expect(operations()).toHaveLength(0);
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies loadTriageContext
   * @scenario The issue belongs to another user's repository
   * @expectedOutput 404, and no provider call: the issue is invisible to the
   *                 join, so it never reaches the service that would write it
   */
  it("should return 404 for a foreign issue", async () => {
    fakeDb.state.rows.repo.push(repoRow({ userId: "user-2" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_preset.push(presetRow());

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(404);
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(operations().filter((entry) => entry.startsWith("db:update"))).toEqual([]);
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies findPresetRow
   * @scenario The preset belongs to another user
   * @expectedOutput 404, and nothing written
   */
  it("should return 404 for a foreign preset", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_preset.push(presetRow({ userId: "user-2" }));

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(404);
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(operations().filter((entry) => entry.startsWith("db:update"))).toEqual([]);
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies findPresetRow
   * @scenario The preset belongs to the user but was saved for a different repo
   * @expectedOutput 404: label names and logins are repo-scoped, so a preset
   *                 from repo A must not be applied to an issue in repo B
   */
  it("should return 404 for a preset from a different repo", async () => {
    fakeDb.state.rows.repo.push(repoRow({ id: OTHER_REPO_ID, fullName: "octo/other" }));
    fakeDb.state.rows.issue.push(issueRow({ repoId: OTHER_REPO_ID }));
    fakeDb.state.rows.triage_preset.push(presetRow({ repoId: REPO_ID }));

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(404);
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(operations().filter((entry) => entry.startsWith("db:update"))).toEqual([]);
  });
});

describe("POST /api/issues/:id/apply-preset — resolution", () => {
  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies resolvePreset
   * @scenario The issue already has every label, assignee, and priority the
   *           preset would set
   * @expectedOutput `noChange: true`, no provider call, no triage_state write,
   *                 no issue update
   */
  it("should perform no provider call and no write for a no-op preset", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    fakeDb.state.rows.issue.push(issueRow({ labels: ["bug"], assignees: ["jo"] }));
    fakeDb.state.rows.triage_state.push(triageRow({ priority: 1 }));
    fakeDb.state.rows.triage_preset.push(
      presetRow({
        actions: { priority: 1, labels: { add: ["bug"] }, assignees: { add: ["jo"] } },
      })
    );

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      mode: "live",
      noChange: true,
      applied: {},
      changes: [],
    });
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockGetProviderToken).not.toHaveBeenCalled();
    expect(operations().filter((entry) => entry.startsWith("db:update"))).toEqual([]);
    expect(operations().filter((entry) => entry.startsWith("db:insert"))).toEqual([]);
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies toPreset, presetActionsSchema
   * @scenario The stored actions no longer validate
   * @expectedOutput 422 and nothing applied: a stale definition is rejected,
   *                 never half-applied
   */
  it("should reject a stale stored preset instead of applying it", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_preset.push(
      presetRow({ actions: { state: "closed", labels: { remove: ["bug"] } } })
    );

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(422);
    expect((res.body as { error: string }).error).toContain("no longer valid");
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(operations().filter((entry) => entry.startsWith("db:update"))).toEqual([]);
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies applyPresetSchema
   * @scenario The body omits `presetId`
   * @expectedOutput 400
   */
  it("should return 400 when presetId is missing", async () => {
    const res = await applyPreset({ batch: true });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/issues/:id/apply-preset — live writes", () => {
  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies getProviderToken, getProvider.updateIssue
   * @scenario A live repo and a resolution that adds a label and a priority
   * @expectedOutput The provider is called before `triage_state` and the issue
   *                 row are written
   */
  it("should call the provider before writing local state", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "live" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_state.push(triageRow());
    fakeDb.state.rows.triage_preset.push(
      presetRow({ actions: { priority: 1, labels: { add: ["bug"] } } })
    );

    const updateIssue = vi.fn(async () => {
      fakeDb.state.log.push("provider:updateIssue");
    });
    mockGetProvider.mockReturnValue(providerStub(updateIssue));

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(200);

    const providerIndex = operations().indexOf("provider:updateIssue");
    const triageWriteIndex = operations().indexOf("db:update:triage_state");
    const issueWriteIndex = operations().indexOf("db:update:issue");

    expect(providerIndex).toBeGreaterThanOrEqual(0);
    expect(triageWriteIndex).toBeGreaterThan(providerIndex);
    expect(issueWriteIndex).toBeGreaterThan(providerIndex);

    expect(updateIssue).toHaveBeenCalledWith("octo", "repo", 7, "token-abc", {
      labels: { add: ["bug"] },
      assignees: undefined,
      state: undefined,
    });

    expect(fakeDb.state.rows.triage_state[0].priority).toBe(1);
    expect(fakeDb.state.rows.issue[0].labels).toEqual(["bug"]);
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies getProvider.updateIssue
   * @scenario The provider rejects the write
   * @expectedOutput 502, `triage_state.priority` unchanged, the cached issue row
   *                 unchanged. This is the regression the refactor exists for.
   */
  it("should not write triage state or the issue when the provider fails", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "live" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_state.push(triageRow({ priority: 3 }));
    fakeDb.state.rows.triage_preset.push(
      presetRow({
        actions: { priority: 0, labels: { add: ["bug"] }, assignees: { add: ["jo"] } },
      })
    );

    mockGetProvider.mockReturnValue(
      providerStub(async () => {
        throw new Error("label does not exist");
      })
    );

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("label does not exist");

    expect(fakeDb.state.rows.triage_state[0].priority).toBe(3);
    expect(fakeDb.state.rows.issue[0].labels).toEqual([]);
    expect(fakeDb.state.rows.issue[0].assignees).toEqual([]);
    expect(operations().filter((entry) => entry.startsWith("db:update"))).toEqual([]);
    expect(operations().filter((entry) => entry.startsWith("db:insert"))).toEqual([]);
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies getProviderToken
   * @scenario No provider token on file
   * @expectedOutput 403 and nothing written
   */
  it("should return 403 without a provider token", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "live" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_state.push(triageRow({ priority: 3 }));
    fakeDb.state.rows.triage_preset.push(
      presetRow({ actions: { priority: 0, labels: { add: ["bug"] } } })
    );
    mockGetProviderToken.mockResolvedValue(null);

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(403);
    expect(fakeDb.state.rows.triage_state[0].priority).toBe(3);
    expect(operations().filter((entry) => entry.startsWith("db:update"))).toEqual([]);
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies applyTriage
   * @scenario The preset carries only personal priority, which never reaches the
   *           provider, and no token is on file
   * @expectedOutput 200: a missing token cannot block a field the provider is
   *                 never asked about
   */
  it("should apply a priority-only preset without a provider token", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "live" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_preset.push(presetRow({ actions: { priority: 0 } }));
    mockGetProviderToken.mockResolvedValue(null);

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(200);
    expect(fakeDb.state.rows.triage_state[0].priority).toBe(0);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies applyTriage
   * @scenario A read-only repository
   * @expectedOutput 403 before the provider is called
   */
  it("should return 403 for a read-only repository", async () => {
    fakeDb.state.rows.repo.push(repoRow({ permission: "read" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_preset.push(presetRow({ actions: { labels: { add: ["bug"] } } }));

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(403);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies providerLimits
   * @scenario The preset carries a label longer than the provider accepts
   * @expectedOutput 400 before any write, so a value GitHub would reject never
   *                 changes local state first
   */
  it("should return 400 for a label over the provider limit", async () => {
    fakeDb.state.rows.repo.push(repoRow({ provider: "github" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_preset.push(
      presetRow({ actions: { priority: 1, labels: { add: ["x".repeat(51)] } } })
    );

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain("limited to 50 characters");
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(operations().filter((entry) => entry.startsWith("db:update"))).toEqual([]);
  });
});

describe("POST /api/issues/:id/apply-preset — batch repos", () => {
  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies applyTriage
   * @scenario The repository's syncMode is `batch`
   * @expectedOutput The resolution is staged in `pendingChanges`, `batchPending`
   *                 is set, and no provider call is made
   */
  it("should stage the change and skip the provider for a batch repo", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "batch" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_state.push(triageRow({ pendingChanges: {} }));
    fakeDb.state.rows.triage_preset.push(
      presetRow({ actions: { priority: 1, labels: { add: ["bug"] } } })
    );

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(200);
    expect((res.body as { mode: string }).mode).toBe("batch");
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(mockGetProviderToken).not.toHaveBeenCalled();

    const saved = fakeDb.state.rows.triage_state[0];
    expect(saved.batchPending).toBe(true);
    expect(saved.pendingChanges).toEqual({ labels: { add: ["bug"], remove: [] } });
    expect(saved.priority).toBe(1);
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies resolveTriageMode
   * @scenario A live repo but the request asks for batch
   * @expectedOutput Mode is `batch` and the provider is not called
   */
  it("should stage when the request asks for batch on a live repo", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "live" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_preset.push(presetRow({ actions: { labels: { add: ["bug"] } } }));

    const res = await applyPreset({ presetId: PRESET_ID, batch: true });

    expect(res.status).toBe(200);
    expect((res.body as { mode: string }).mode).toBe("batch");
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies resolveTriageMode
   * @scenario A batch repo but the request omits the flag
   * @expectedOutput The stored `syncMode` wins: the mode is `batch` and no
   *                 provider write is attempted
   */
  it("should honour the repo syncMode even without a batch flag", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "batch" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_preset.push(presetRow({ actions: { labels: { add: ["bug"] } } }));

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(200);
    expect((res.body as { mode: string }).mode).toBe("batch");
    expect(mockGetProvider).not.toHaveBeenCalled();
  });
});

describe("POST /api/issues/:id/apply-preset — response", () => {
  /**
   * @target POST /api/issues/:id/apply-preset
   * @dependencies resolvePreset
   * @scenario A live apply that adds one label and skips one the issue has
   * @expectedOutput The response carries the mode, what was applied, and the
   *                 preview lines so the toast cannot disagree with the write
   */
  it("should return the effective mode, the applied payload, and the preview", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "live" }));
    fakeDb.state.rows.issue.push(issueRow({ labels: ["triage"] }));
    fakeDb.state.rows.triage_preset.push(
      presetRow({ actions: { priority: 2, labels: { add: ["triage", "bug"] } } })
    );

    const res = await applyPreset({ presetId: PRESET_ID });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      mode: "live",
      noChange: false,
      applied: { priority: 2, labels: { add: ["bug"] } },
      changes: [
        { kind: "priority", value: "P2", operation: "+" },
        { kind: "label", value: "triage", operation: "=" },
        { kind: "label", value: "bug", operation: "+" },
      ],
    });
    expect(fakeDb.state.rows.issue[0].labels).toEqual(["triage", "bug"]);
  });
});
