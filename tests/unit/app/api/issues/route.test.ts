/**
 * @module tests/unit/app/api/issues/route
 *
 * Unit tests for `PATCH /api/issues/[id]` after it was moved onto the shared
 * triage service.
 *
 * The route's observable contract must not change — 401/400/403/404/502 and a
 * `{ ok: true }` body — but the ordering behind it must: on a live write the
 * provider is called before `triage_state` is touched, and a provider rejection
 * commits nothing at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PATCH } from "@/app/api/issues/[id]/route";
import { auth } from "@/auth";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import type { IssueProvider } from "@/lib/provider-interface";
import { ISSUE_ID, fakeDb, issueRow, repoRow, triageRow } from "../../../support/fake-db";

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

function providerStub(updateIssue: () => Promise<void>) {
  return {
    updateIssue: vi.fn(updateIssue),
    fetchIssues: vi.fn().mockResolvedValue([]),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
  } satisfies IssueProvider;
}

async function patchIssue(body: unknown, issueId = ISSUE_ID) {
  const req = new Request(`http://localhost/api/issues/${issueId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  await PATCH(req, { params: Promise.resolve({ id: issueId }) });
  return { status: lastStatus, body: lastBody };
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

describe("PATCH /api/issues/:id", () => {
  /**
   * @target PATCH /api/issues/:id
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await patchIssue({ priority: 1 });

    expect(res.status).toBe(401);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target PATCH /api/issues/:id
   * @dependencies triagePatchSchema
   * @scenario Priority outside the accepted range
   * @expectedOutput 400 and no write
   */
  it("should return 400 for an invalid body", async () => {
    const res = await patchIssue({ priority: 9 });

    expect(res.status).toBe(400);
    expect(fakeDb.state.log).toHaveLength(0);
  });

  /**
   * @target PATCH /api/issues/:id
   * @dependencies loadTriageContext
   * @scenario The issue belongs to another user's repo
   * @expectedOutput 404, never 403
   */
  it("should return 404 for a foreign issue", async () => {
    fakeDb.state.rows.repo.push(repoRow({ userId: "user-2" }));
    fakeDb.state.rows.issue.push(issueRow());

    const res = await patchIssue({ priority: 1 });

    expect(res.status).toBe(404);
  });

  /**
   * @target PATCH /api/issues/:id
   * @dependencies applyTriage
   * @scenario A combined write on a live repo: priority plus a label
   * @expectedOutput `{ ok: true }`, with the provider called before either local
   *                 write. This is the ordering the refactor is for.
   */
  it("should call the provider before committing local fields", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "live" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_state.push(triageRow({ priority: 3 }));

    const updateIssue = vi.fn(async () => {
      fakeDb.state.log.push("provider:updateIssue");
    });
    mockGetProvider.mockReturnValue(providerStub(updateIssue));

    const res = await patchIssue({ priority: 1, labels: { add: ["bug"] } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    const log = fakeDb.state.log;
    const providerIndex = log.indexOf("provider:updateIssue");
    expect(providerIndex).toBeGreaterThanOrEqual(0);
    expect(log.indexOf("db:update:triage_state")).toBeGreaterThan(providerIndex);
    expect(log.indexOf("db:update:issue")).toBeGreaterThan(providerIndex);

    expect(fakeDb.state.rows.triage_state[0].priority).toBe(1);
    expect(fakeDb.state.rows.issue[0].labels).toEqual(["bug"]);
  });

  /**
   * @target PATCH /api/issues/:id
   * @dependencies getProvider.updateIssue
   * @scenario The provider rejects the write of a payload that also carried a
   *           priority
   * @expectedOutput 502 and the priority is left at its previous value. Before
   *                 the refactor the priority was committed first and survived
   *                 the failure.
   */
  it("should commit nothing when the provider rejects a combined write", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "live" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_state.push(triageRow({ priority: 3 }));
    mockGetProvider.mockReturnValue(
      providerStub(async () => {
        throw new Error("label does not exist");
      })
    );

    const res = await patchIssue({ priority: 0, labels: { add: ["bug"] } });

    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("label does not exist");
    expect(fakeDb.state.rows.triage_state[0].priority).toBe(3);
    expect(fakeDb.state.rows.issue[0].labels).toEqual([]);
  });

  /**
   * @target PATCH /api/issues/:id
   * @dependencies applyTriage
   * @scenario A batch repository
   * @expectedOutput 200 with the change staged and the provider never called
   */
  it("should stage the change on a batch repo without a provider call", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "batch" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_state.push(triageRow());

    const res = await patchIssue({ priority: 2, labels: { add: ["bug"] } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockGetProvider).not.toHaveBeenCalled();
    expect(fakeDb.state.rows.triage_state[0].batchPending).toBe(true);
    expect(fakeDb.state.rows.triage_state[0].pendingChanges).toEqual({
      labels: { add: ["bug"], remove: [] },
    });
  });

  /**
   * @target PATCH /api/issues/:id
   * @dependencies applyTriage
   * @scenario A priority-only change on a live repo with no provider token
   * @expectedOutput 200: priority is personal, so it needs no provider token
   */
  it("should apply a priority-only change without a provider token", async () => {
    fakeDb.state.rows.repo.push(repoRow({ syncMode: "live" }));
    fakeDb.state.rows.issue.push(issueRow());
    mockGetProviderToken.mockResolvedValue(null);

    const res = await patchIssue({ priority: 1 });

    expect(res.status).toBe(200);
    expect(fakeDb.state.rows.triage_state[0].priority).toBe(1);
  });

  /**
   * @target PATCH /api/issues/:id
   * @dependencies applyTriage
   * @scenario A read-only repository receiving a label change
   * @expectedOutput 403
   */
  it("should return 403 for a provider write on a read-only repo", async () => {
    fakeDb.state.rows.repo.push(repoRow({ permission: "read" }));
    fakeDb.state.rows.issue.push(issueRow());

    const res = await patchIssue({ labels: { add: ["bug"] } });

    expect(res.status).toBe(403);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target PATCH /api/issues/:id
   * @dependencies providerLimits
   * @scenario A label longer than the provider accepts
   * @expectedOutput 400 before anything is written
   */
  it("should return 400 for a label over the provider limit", async () => {
    fakeDb.state.rows.repo.push(repoRow({ provider: "github" }));
    fakeDb.state.rows.issue.push(issueRow());
    fakeDb.state.rows.triage_state.push(triageRow({ priority: 3 }));

    const res = await patchIssue({ priority: 0, labels: { add: ["x".repeat(51)] } });

    expect(res.status).toBe(400);
    expect(fakeDb.state.rows.triage_state[0].priority).toBe(3);
  });
});
