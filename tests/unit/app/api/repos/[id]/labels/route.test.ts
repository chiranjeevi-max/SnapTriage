/**
 * @module tests/unit/app/api/repos/[id]/labels/route.test.ts
 *
 * The labels and collaborators routes back the two pickers that every triage
 * action opens. Both were untested, and both answer `200 []` for a provider
 * failure as well as for a repository with none — which is the one thing a test
 * should record explicitly, so a later change to that contract is deliberate.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET as getLabels } from "@/app/api/repos/[id]/labels/route";
import { GET as getCollaborators } from "@/app/api/repos/[id]/collaborators/route";
import { auth } from "@/auth";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";
import type { IssueProvider } from "@/lib/provider-interface";
import { REPO_ID, fakeDb, repoRow } from "../../../../../support/fake-db";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/providers", () => ({ getProvider: vi.fn() }));
vi.mock("@/features/auth/get-provider-token", () => ({ getProviderToken: vi.fn() }));
vi.mock("@/lib/db/query", async () => {
  const { fakeDb } = await import("../../../../../support/fake-db");
  return { typedDb: fakeDb.typedDb };
});
vi.mock("@/lib/logger", () => ({
  apiLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockAuth = vi.mocked(auth);
const mockGetProvider = vi.mocked(getProvider);
const mockGetProviderToken = vi.mocked(getProviderToken);

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

function stubProvider(overrides: Partial<IssueProvider> = {}): IssueProvider {
  return {
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
    getRepoPermission: vi.fn().mockResolvedValue("write"),
    ...overrides,
  };
}

function context(id = REPO_ID) {
  return { params: Promise.resolve({ id }) };
}

type RouteHandler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<unknown>;

async function call(handler: RouteHandler) {
  await handler(new Request("http://localhost/api/repos/x/labels"), context());
  return { status: lastStatus, body: lastBody };
}

beforeEach(() => {
  vi.clearAllMocks();
  fakeDb.reset();
  lastStatus = 0;
  lastBody = null;
  mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
  mockGetProviderToken.mockResolvedValue("token-abc");
});

describe("GET /api/repos/:id/labels", () => {
  /**
   * @target GET /api/repos/:id/labels
   * @dependencies auth
   * @scenario No session
   * @expectedOutput 401 before any provider call
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    expect((await call(getLabels)).status).toBe(401);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target GET /api/repos/:id/labels
   * @dependencies loadTriageContext
   * @scenario The repo belongs to another user
   * @expectedOutput 404, never 403
   */
  it("should return 404 for a foreign repo", async () => {
    fakeDb.state.rows.repo.push(repoRow({ userId: "user-2" }));

    expect((await call(getLabels)).status).toBe(404);
  });

  /**
   * @target GET /api/repos/:id/labels
   * @dependencies getProviderToken
   * @scenario The user has no stored token
   * @expectedOutput 401 rather than an empty list, so the picker is not told the
   *                 repository has no labels when the real problem is the token
   */
  it("should return 401 without a provider token", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    mockGetProviderToken.mockResolvedValue(null);

    expect((await call(getLabels)).status).toBe(401);
  });

  it("should return the provider's labels", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    const labels = [{ name: "bug", color: "d73a4a", description: null }];
    mockGetProvider.mockReturnValue(
      stubProvider({ fetchLabels: vi.fn().mockResolvedValue(labels) })
    );

    expect(await call(getLabels)).toEqual({ status: 200, body: labels });
  });

  /**
   * @target GET /api/repos/:id/labels
   * @dependencies provider.fetchLabels
   * @scenario The provider does not implement label reads
   * @expectedOutput 200 with an empty array, which the picker renders as "no
   *                 labels" — the honest answer for a capability that is absent
   */
  it("should answer an empty list when the provider cannot read labels", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    mockGetProvider.mockReturnValue(stubProvider());

    expect(await call(getLabels)).toEqual({ status: 200, body: [] });
  });

  /**
   * @target GET /api/repos/:id/labels
   * @dependencies provider.fetchLabels
   * @scenario The provider read fails partway (an expired token, a permission
   *           the token lost)
   * @expectedOutput 200 with an empty array today, because `fetchLabels` reports
   *                 a failed page as "no more labels". Recorded here so the
   *                 ambiguity is a known contract rather than a surprise: the
   *                 picker cannot distinguish it from a repository with none.
   */
  it("should report a failed provider read as an empty list", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    mockGetProvider.mockReturnValue(stubProvider({ fetchLabels: vi.fn().mockResolvedValue([]) }));

    expect(await call(getLabels)).toEqual({ status: 200, body: [] });
  });
});

describe("GET /api/repos/:id/collaborators", () => {
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    expect((await call(getCollaborators)).status).toBe(401);
  });

  it("should return 404 for a foreign repo", async () => {
    fakeDb.state.rows.repo.push(repoRow({ userId: "user-2" }));

    expect((await call(getCollaborators)).status).toBe(404);
  });

  it("should return 401 without a provider token", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    mockGetProviderToken.mockResolvedValue(null);

    expect((await call(getCollaborators)).status).toBe(401);
  });

  it("should return the provider's collaborators", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    const collaborators = [{ username: "octocat", avatar: null, permission: "write" as const }];
    mockGetProvider.mockReturnValue(
      stubProvider({ fetchCollaborators: vi.fn().mockResolvedValue(collaborators) })
    );

    expect(await call(getCollaborators)).toEqual({ status: 200, body: collaborators });
  });

  /**
   * @target GET /api/repos/:id/collaborators
   * @dependencies provider.fetchCollaborators
   * @scenario The provider cannot list members
   * @expectedOutput 200 with an empty array, so the assignee picker offers
   *                 nobody rather than failing to open at all
   */
  it("should answer an empty list when the provider cannot read members", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    mockGetProvider.mockReturnValue(stubProvider());

    expect(await call(getCollaborators)).toEqual({ status: 200, body: [] });
  });

  /**
   * @target GET /api/repos/:id/collaborators
   * @dependencies provider.fetchCollaborators
   * @scenario The provider read throws
   * @expectedOutput 502 rather than an empty list, for the same reason as labels.
   */
  it("should report a failed provider read as 502", async () => {
    fakeDb.state.rows.repo.push(repoRow());
    mockGetProvider.mockReturnValue(
      stubProvider({
        fetchCollaborators: vi.fn().mockRejectedValue(new Error("provider is down")),
      })
    );

    const result = await call(getCollaborators);

    expect(result.status).toBe(502);
    expect((result.body as { error: string }).error).toBe("provider is down");
  });
});
