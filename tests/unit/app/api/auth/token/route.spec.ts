/**
 * @module tests/unit/app/api/auth/token/route.spec.ts
 * Unit tests for the PAT validation API route.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/auth/token/route";
import { validateToken } from "@/features/auth/validate-token";
import { checkPersistentRateLimit } from "@/lib/rate-limit";

vi.mock("@/features/auth/validate-token", () => ({
  validateToken: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkPersistentRateLimit: vi.fn().mockResolvedValue(false),
}));

describe("POST /api/auth/token", () => {
  it("should return 200 and user data on successful validation", async () => {
    const mockUser = {
      id: "1",
      name: "Test User",
      email: "test@example.com",
      image: "https://avatar.url",
    };
    vi.mocked(validateToken).mockResolvedValueOnce(mockUser);

    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ token: "valid-gh-token", provider: "github" }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ valid: true, user: mockUser });
    expect(validateToken).toHaveBeenCalledWith("valid-gh-token", "github");
  });

  it("should return 400 if token is missing", async () => {
    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ provider: "github" }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("token: Invalid input: expected string, received undefined");
  });

  it("should return 400 if provider is invalid", async () => {
    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ token: "token", provider: "bitbucket" }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('provider: Invalid option: expected one of "github"|"gitlab"');
  });

  it("should return 401 if validateToken fails", async () => {
    vi.mocked(validateToken).mockRejectedValueOnce(new Error("Unauthorized"));

    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ token: "invalid-token", provider: "gitlab" }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Invalid token");
  });

  it("should return 400 if request body parsing fails", async () => {
    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: "not-a-json",
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe('token: Invalid input: expected string, received undefined; provider: Invalid option: expected one of "github"|"gitlab"');
  });

  it("should return 401 when encountering an unexpected error in the route handler", async () => {
    // This empty object missing the json() method simulates an internal error
    // within the POST handler, triggering the catch block.
    const req = {} as Request;

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Invalid token");
  });
});

describe("POST /api/auth/token rate limiting", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    // One proxy sits in front of the app, so the address it appends to
    // X-Forwarded-For is the one that may be believed.
    process.env = { ...ORIGINAL_ENV, TRUSTED_PROXY_HOPS: "1" };
    vi.mocked(checkPersistentRateLimit).mockResolvedValue(false);
    vi.mocked(validateToken).mockResolvedValue({
      id: "1",
      name: "U",
      email: "u@example.com",
      image: null,
    });
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  /** POSTs a token with the supplied forwarding headers and returns the limit key used. */
  async function limitKeyFor(headers: Record<string, string>): Promise<string> {
    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      headers,
      body: JSON.stringify({ token: "t", provider: "github" }),
    });
    await POST(req);
    return vi.mocked(checkPersistentRateLimit).mock.calls.at(-1)![0];
  }

  /**
   * @target POST /api/auth/token
   * @dependencies clientIp, checkPersistentRateLimit (mocked)
   * @scenario Two requests carry different spoofed x-real-ip values but the same
   *           real client address appended by the trusted proxy
   * @expectedOutput Both resolve to the identical key. Keying off a header the
   *                 client controls would hand each attempt a fresh allowance
   *                 and disable the limit entirely.
   */
  it("ignores a rotating x-real-ip and keys on the proxy-appended address", async () => {
    const first = await limitKeyFor({
      "x-real-ip": "10.0.0.1",
      "x-forwarded-for": "forged-a, 198.51.100.7",
    });
    const second = await limitKeyFor({
      "x-real-ip": "10.0.0.2",
      "x-forwarded-for": "forged-b, 198.51.100.7",
    });

    expect(first).toBe(second);
    expect(first).toContain("198.51.100.7");
  });

  /**
   * @target POST /api/auth/token
   * @dependencies clientIp, checkPersistentRateLimit (mocked)
   * @scenario Requests arrive with no forwarding headers at all
   * @expectedOutput They share one stable key rather than each getting an
   *                 independent allowance, and never an empty-string key
   */
  it("collapses requests with no forwarding headers onto one stable key", async () => {
    const first = await limitKeyFor({});
    const second = await limitKeyFor({});

    expect(first).toBe(second);
    expect(first).not.toBe("");
  });

  /**
   * @target POST /api/auth/token
   * @dependencies checkPersistentRateLimit (mocked)
   * @scenario The shared counter reports the caller is over its allowance
   * @expectedOutput A 429 is returned and no upstream token validation is
   *                 attempted, so a blocked caller cannot burn provider quota
   */
  it("returns 429 without calling the provider when the limit is exceeded", async () => {
    vi.mocked(checkPersistentRateLimit).mockResolvedValue(true);

    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      headers: { "x-forwarded-for": "198.51.100.7" },
      body: JSON.stringify({ token: "t", provider: "github" }),
    });

    const response = await POST(req);

    expect(response.status).toBe(429);
    expect(validateToken).not.toHaveBeenCalled();
  });
});
