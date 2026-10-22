/**
 * @module tests/unit/app/api/repos/route.spec.ts
 *
 * Unit tests for POST /api/repos — connecting a new repository.
 *
 * Security contract (OWASP A01):
 * - `permission` is derived server-side from the provider API; the client
 *   value is ignored. A client cannot self-grant admin/write access.
 * - The stored repository identity is derived server-side from the owner/name
 *   pair the permission was resolved for, so a client cannot point the record
 *   at a repository it does not control.
 * - A valid provider token is required before a repo can be connected.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/repos/route";
import { auth } from "@/auth";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";
import {
  connectRepo,
  findConnectedRepo,
} from "@/features/repos/repo-repository";
import type { IssueProvider } from "@/lib/provider-interface";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));
vi.mock("@/features/auth/get-provider-token", () => ({
  getProviderToken: vi.fn(),
}));
vi.mock("@/lib/providers", () => ({
  getProvider: vi.fn(),
}));
vi.mock("@/features/repos/repo-repository", () => ({
  connectRepo: vi.fn(),
  findConnectedRepo: vi.fn(),
}));

const mockAuth = vi.mocked(auth);
const mockGetProviderToken = vi.mocked(getProviderToken);
const mockGetProvider = vi.mocked(getProvider);
const mockConnectRepo = vi.mocked(connectRepo);
const mockFindConnectedRepo = vi.mocked(findConnectedRepo);

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

const repoPayload = {
  provider: "github" as const,
  owner: "test-owner",
  name: "test-repo",
};

/** Builds a provider stub whose permission lookup is configurable. */
function providerStub(permission: "admin" | "write" | "read" | null) {
  return {
    getRepoPermission: vi.fn().mockResolvedValue(permission),
    fetchIssues: vi.fn().mockResolvedValue([]),
    updateIssue: vi.fn().mockResolvedValue(undefined),
  } satisfies IssueProvider;
}

async function postRepo(body: unknown, headers: Record<string, string> = {}) {
  const req = new Request("http://localhost/api/repos", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  await POST(req);
  return { status: lastStatus, body: lastBody };
}

describe("POST /api/repos", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastStatus = 0;
    lastBody = null;
    mockFindConnectedRepo.mockResolvedValue(null as never);
    mockConnectRepo.mockResolvedValue("repo-id-123");
  });

  /**
   * @target POST /api/repos
   * @dependencies auth, getProviderToken, getProvider.getRepoPermission
   * @scenario Valid session and token, provider reports write access
   * @expectedOutput 201; stored permission is "write" (from provider)
   */
  it("should derive permission from the provider, ignoring the client value", async () => {
    // Client tries to self-grant admin
    const body = { ...repoPayload, permission: "admin" };

    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockGetProviderToken.mockResolvedValue("github-token-123");
    const providerMock = providerStub("write");
    mockGetProvider.mockReturnValue(providerMock);

    const res = await postRepo(body);

    expect(res.status).toBe(201);
    expect(providerMock.getRepoPermission).toHaveBeenCalledWith(
      "test-owner",
      "test-repo",
      "github-token-123"
    );
    expect(mockConnectRepo).toHaveBeenCalledWith(
      expect.objectContaining({ permission: "write" })
    );
  });

  /**
   * @target POST /api/repos
   * @dependencies auth, getProviderToken, getProvider.getRepoPermission
   * @scenario The client names a different repository in `fullName` than the
   *           owner/name pair it asks to connect
   * @expectedOutput The stored identity is the one the permission was resolved
   *                 for, so the client cannot point the record at a repository
   *                 it does not control
   */
  it("should derive the stored full name from owner and name", async () => {
    const body = { ...repoPayload, fullName: "someone-else/their-repo" };

    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockGetProviderToken.mockResolvedValue("github-token-123");
    mockGetProvider.mockReturnValue(providerStub("write"));

    const res = await postRepo(body);

    expect(res.status).toBe(201);
    expect(mockConnectRepo).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "test-owner/test-repo" })
    );
  });

  /**
   * @target POST /api/repos
   * @dependencies auth
   * @scenario No valid session
   * @expectedOutput 401
   */
  it("should return 401 when not authenticated", async () => {
    mockAuth.mockResolvedValue(null as never);

    const res = await postRepo(repoPayload);

    expect(res.status).toBe(401);
    expect(mockGetProviderToken).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/repos
   * @dependencies getProviderToken
   * @scenario No provider token on file
   * @expectedOutput 403; no provider call is made
   */
  it("should return 403 when no provider token is available", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockGetProviderToken.mockResolvedValue(null);

    const res = await postRepo(repoPayload);

    expect(res.status).toBe(403);
    expect(mockGetProvider).not.toHaveBeenCalled();
  });

  /**
   * @target POST /api/repos
   * @dependencies getProvider.getRepoPermission
   * @scenario Token exists but cannot access the repository
   * @expectedOutput 404; repo is not connected
   */
  it("should return 404 when the provider cannot see the repository", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);
    mockGetProviderToken.mockResolvedValue("github-token-123");
    mockGetProvider.mockReturnValue(providerStub(null));

    const res = await postRepo(repoPayload);

    expect(res.status).toBe(404);
    expect(mockGetProvider).toHaveBeenCalledWith("github");
  });

  /**
   * @target POST /api/repos
   * @dependencies auth
   * @scenario The request body is not valid JSON
   * @expectedOutput 400 instead of an unhandled parse failure
   */
  it("should return 400 for a malformed JSON body", async () => {
    mockAuth.mockResolvedValue({ user: { id: "user-1" } } as never);

    const res = await postRepo("{not json");

    expect(res.status).toBe(400);
    expect(mockConnectRepo).not.toHaveBeenCalled();
  });
});
