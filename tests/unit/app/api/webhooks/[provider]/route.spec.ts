/**
 * @module tests/unit/app/api/webhooks/[provider]/route.spec.ts
 *
 * Unit tests for the GitHub/GitLab webhook ingestion endpoint.
 *
 * Security contract (OWASP A04, A05):
 * - Authentication must be header-borne (HMAC for GitHub, shared-secret header for GitLab),
 *   never a URL query parameter that lands in access logs.
 * - Rejected before any upstream work: unknown provider, missing secret config,
 *   missing/invalid signature, replayed delivery.
 * - Expensive sync work is rate-limited per client IP.
 */

import { POST } from "@/app/api/webhooks/[provider]/route";
import { checkPersistentRateLimit } from "@/lib/rate-limit";
import { syncRepo } from "@/features/sync/sync-engine";
import { forgetDelivery, recordDelivery } from "@/features/webhooks/delivery-store";
import { typedDb } from "@/lib/db/query";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/features/sync/sync-engine", () => ({
  syncRepo: vi.fn(),
}));
vi.mock("@/lib/rate-limit", () => ({
  checkPersistentRateLimit: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/features/webhooks/delivery-store", () => ({
  recordDelivery: vi.fn().mockResolvedValue(true),
  forgetDelivery: vi.fn().mockResolvedValue(undefined),
  purgeExpiredDeliveries: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/db/query", () => ({
  typedDb: {
    select: vi.fn(),
  },
}));

const mockSyncRepo = vi.mocked(syncRepo);
const mockRateLimit = vi.mocked(checkPersistentRateLimit);
const mockRecordDelivery = vi.mocked(recordDelivery);
const mockForgetDelivery = vi.mocked(forgetDelivery);
const mockSelect = vi.mocked(typedDb.select);

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { createHmac } from "node:crypto";

/** Signs the exact bytes GitHub would have signed. */
function hmac256(secret: string, payload: Buffer | string): string {
  return "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * Posts a delivery.
 *
 * @param body - The payload; a Buffer is sent verbatim, anything else is JSON encoded.
 */
async function postDelivery(
  body: Buffer | Record<string, unknown>,
  signature: string | null,
  headers: Record<string, string> = {},
  provider = "github"
): Promise<{ status: number; body?: unknown }> {
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body), "utf8");
  const req = new Request(`http://localhost/api/webhooks/${provider}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(signature !== null ? { "x-hub-signature-256": signature } : {}),
      ...headers,
    },
    body: new Uint8Array(payload),
  });
  const params = Promise.resolve({ provider });
  const res = (await POST(req, { params })) as { status: number; body?: unknown };
  return res;
}

/** Configures the select().from().where().limit() chain to return the given rows. */
function selectReturns(rows: unknown[]) {
  const limitMock = vi.fn().mockResolvedValue(rows);
  const whereMock = vi.fn().mockReturnValue({ limit: limitMock });
  const fromMock = vi.fn().mockReturnValue({ where: whereMock });
  mockSelect.mockReturnValue({ from: fromMock } as never);
  return whereMock;
}

describe("POST /api/webhooks/:provider", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    selectReturns([]);
    mockRecordDelivery.mockResolvedValue(true);
    mockRateLimit.mockResolvedValue(false);
    mockSyncRepo.mockResolvedValue({ repoId: "repo-1", status: "completed", issuesFetched: 3 });
    lastStatus = 0;
    process.env = { ...ORIGINAL_ENV, WEBHOOK_SECRET: "whsec_test_secret" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("authentication", () => {
    /**
     * @target POST /api/webhooks/:provider
     * @dependencies process.env.WEBHOOK_SECRET
     * @scenario The WEBHOOK_SECRET environment variable is unset
     * @expectedOutput 503 so misconfigured deployments fail closed rather than
     *                 accepting deliveries blindly
     */
    it("should return 503 when the webhook secret is not configured", async () => {
      delete process.env.WEBHOOK_SECRET;

      const res = await postDelivery(
        { repository: { full_name: "o/r" } },
        hmac256("x", "{}"),
        { "x-github-delivery": "delivery-503" }
      );

      expect(res.status).toBe(503);
      expect(mockSyncRepo).not.toHaveBeenCalled();
    });

    /**
     * @target POST /api/webhooks/:provider
     * @dependencies WEBHOOK_SECRET, X-Hub-Signature-256 header
     * @scenario A valid GitHub HMAC signature over the exact body bytes
     * @expectedOutput 200 and sync is triggered
     */
    it("should accept a valid GitHub HMAC signature", async () => {
      const body = { repository: { full_name: "owner/repo" } };
      const payload = JSON.stringify(body);
      const signature = hmac256("whsec_test_secret", payload);

      selectReturns([{ id: "repo-1", userId: "USR-001" }]);

      const res = await postDelivery(body, signature, { "x-github-delivery": "delivery-001" });

      expect(res.status).toBe(200);
      expect(mockSyncRepo).toHaveBeenCalledTimes(1);
    });

    /**
     * @target POST /api/webhooks/:provider
     * @dependencies WEBHOOK_SECRET, X-Gitlab-Token header
     * @scenario A valid GitLab shared-secret header
     * @expectedOutput 200 and sync is triggered
     */
    it("should accept a valid GitLab token header", async () => {
      selectReturns([{ id: "repo-1", userId: "USR-001" }]);

      const res = await postDelivery(
        { project: { path_with_namespace: "owner/repo" } },
        null,
        { "x-gitlab-token": "whsec_test_secret", "x-gitlab-event-uuid": "gitlab-001" },
        "gitlab"
      );

      expect(res.status).toBe(200);
      expect(mockSyncRepo).toHaveBeenCalledTimes(1);
    });

    /**
     * @target POST /api/webhooks/:provider
     * @dependencies WEBHOOK_SECRET, X-Hub-Signature-256 header
     * @scenario A signature that does not match the body
     * @expectedOutput 401; delivery rejected before any sync work
     */
    it("should reject a mismatched GitHub signature", async () => {
      const body = { repository: { full_name: "owner/repo" } };
      const signature = hmac256("wrong-secret", JSON.stringify(body));

      const res = await postDelivery(body, signature, { "x-github-delivery": "delivery-401" });

      expect(res.status).toBe(401);
      expect(mockSyncRepo).not.toHaveBeenCalled();
    });

    /**
     * @target POST /api/webhooks/:provider
     * @dependencies WEBHOOK_SECRET
     * @scenario No signature header at all
     * @expectedOutput 401
     */
    it("should reject requests without a GitHub signature header", async () => {
      const body = { repository: { full_name: "owner/repo" } };

      const res = await postDelivery(body, null, { "x-github-delivery": "delivery-401b" });

      expect(res.status).toBe(401);
      expect(mockSyncRepo).not.toHaveBeenCalled();
    });

    /**
     * @target POST /api/webhooks/:provider
     * @dependencies WEBHOOK_SECRET, X-Hub-Signature-256 header
     * @scenario The body contains bytes that are not valid UTF-8
     * @expectedOutput The delivery is authenticated. The signature covers the
     *                 raw bytes the provider sent, so re-encoding a decoded
     *                 string would replace the invalid sequences and break the
     *                 comparison; a legitimate delivery would be dropped.
     */
    it("should verify the signature over the raw body bytes", async () => {
      const payload = Buffer.concat([
        Buffer.from('{"repository":{"full_name":"owner/repo"},"note":"', "utf8"),
        Buffer.from([0xff]),
        Buffer.from('"}', "utf8"),
      ]);

      selectReturns([{ id: "repo-1", userId: "USR-001" }]);

      const res = await postDelivery(payload, hmac256("whsec_test_secret", payload), {
        "x-github-delivery": "delivery-raw",
      });

      expect(res.status).toBe(200);
      expect(mockSyncRepo).toHaveBeenCalledTimes(1);
    });

    /**
     * @target POST /api/webhooks/:provider
     * @dependencies WEBHOOK_SECRET
     * @scenario An unknown provider is requested
     * @expectedOutput 404 before any secret comparison
     */
    it("should return 404 for an unsupported provider", async () => {
      const req = new Request("http://localhost/api/webhooks/bitbucket", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const params = Promise.resolve({ provider: "bitbucket" });
      const res = (await POST(req, { params })) as { status: number; body?: unknown };

      expect(res.status).toBe(404);
      expect(mockSyncRepo).not.toHaveBeenCalled();
    });
  });

  describe("delivery identity", () => {
    /**
     * @target POST /api/webhooks/:provider
     * @dependencies WEBHOOK_SECRET, delivery dedup table
     * @scenario The same delivery ID arrives twice (replay)
     * @expectedOutput Second attempt is detected as a duplicate and ignored;
     *                 sync runs only once
     */
    it("should ignore a replayed delivery ID", async () => {
      const body = { repository: { full_name: "owner/repo" } };
      const signature = hmac256("whsec_test_secret", JSON.stringify(body));

      selectReturns([{ id: "repo-1", userId: "USR-001" }]);

      // First attempt: the delivery ID has not been seen before.
      mockRecordDelivery.mockResolvedValueOnce(true);
      const res1 = await postDelivery(body, signature, { "x-github-delivery": "delivery-001" });
      expect(res1.status).toBe(200);

      // Second attempt: same delivery ID, already on record.
      mockRecordDelivery.mockResolvedValueOnce(false);
      const res2 = await postDelivery(body, signature, { "x-github-delivery": "delivery-001" });

      expect(res2.status).toBe(200);
      expect(lastBody).toMatchObject({ ignored: true });
      expect(mockSyncRepo).toHaveBeenCalledTimes(1);
    });

    /**
     * @target POST /api/webhooks/:provider
     * @dependencies WEBHOOK_SECRET
     * @scenario A delivery arrives without a delivery ID
     * @expectedOutput 400. Both providers always send one, and without it
     *                 there is no replay protection at all.
     */
    it("should reject a delivery that carries no delivery ID", async () => {
      const body = { repository: { full_name: "owner/repo" } };
      const signature = hmac256("whsec_test_secret", JSON.stringify(body));

      const res = await postDelivery(body, signature);

      expect(res.status).toBe(400);
      expect(mockSyncRepo).not.toHaveBeenCalled();
    });
  });

  describe("sync outcome", () => {
    /**
     * @target POST /api/webhooks/:provider
     * @dependencies syncRepo
     * @scenario The sync triggered by the delivery fails
     * @expectedOutput 500 and the delivery record is dropped, so the provider
     *                 can re-deliver it instead of the work being lost
     */
    it("should report a failed sync and keep the delivery retryable", async () => {
      const body = { repository: { full_name: "owner/repo" } };
      const signature = hmac256("whsec_test_secret", JSON.stringify(body));

      selectReturns([{ id: "repo-1", userId: "USR-001" }]);
      mockSyncRepo.mockResolvedValue({
        repoId: "repo-1",
        status: "failed",
        issuesFetched: 0,
        error: "provider exploded",
      });

      const res = await postDelivery(body, signature, { "x-github-delivery": "delivery-fail" });

      expect(res.status).toBe(500);
      expect(mockForgetDelivery).toHaveBeenCalledWith("github", "delivery-fail");
    });
  });

  describe("rate limiting and cost bounds", () => {
    /**
     * @target POST /api/webhooks/:provider
     * @dependencies checkPersistentRateLimit (mocked)
     * @scenario The shared counter reports the caller is over its allowance
     * @expectedOutput 429 returned before any signature work or sync
     */
    it("should rate-limit before syncing", async () => {
      mockRateLimit.mockResolvedValue(true);

      const body = { repository: { full_name: "owner/repo" } };
      const signature = hmac256("whsec_test_secret", JSON.stringify(body));

      const res = await postDelivery(body, signature, {
        "x-forwarded-for": "198.51.100.7",
        "x-github-delivery": "delivery-429",
      });

      expect(res.status).toBe(429);
      expect(mockSyncRepo).not.toHaveBeenCalled();
    });

    /**
     * @target POST /api/webhooks/:provider
     * @dependencies process.env.WEBHOOK_SECRET
     * @scenario JSON body is malformed
     * @expectedOutput 400: the endpoint parses safely instead of crashing
     */
    it("should return 400 for a malformed JSON body", async () => {
      const req = new Request("http://localhost/api/webhooks/github", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-hub-signature-256": hmac256("whsec_test_secret", "not-json"),
          "x-github-delivery": "delivery-badjson",
        },
        body: "not-json",
      });
      const params = Promise.resolve({ provider: "github" });
      const res = (await POST(req, { params })) as { status: number; body?: unknown };

      expect(res.status).toBe(400);
      expect(mockSyncRepo).not.toHaveBeenCalled();
    });
  });
});
