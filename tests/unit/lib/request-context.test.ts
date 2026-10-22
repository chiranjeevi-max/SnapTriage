/**
 * @module tests/unit/lib/request-context.test.ts
 *
 * Unit tests for client IP resolution used to key rate limits.
 *
 * The threat model is header spoofing: a client that can choose its own
 * rate-limit key gets a fresh allowance on every request, which turns the
 * limiter into a no-op. These tests pin the trust boundary — only hops
 * appended by a proxy we actually sit behind are believed, and nothing is
 * believed at all until the deployment says how many proxies there are.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { clientIp, rateLimitKey } from "@/lib/request-context";

/** Builds a Request carrying the supplied forwarding headers. */
function requestWith(headers: Record<string, string>): Request {
  return new Request("http://localhost/api/auth/token", { headers });
}

describe("clientIp", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.TRUSTED_PROXY_HOPS;
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  describe("X-Forwarded-For handling", () => {
    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario A single reverse proxy appends the real client address
     * @expectedOutput That appended value, not the client-supplied prefix
     */
    it("should trust the hop appended by a single trusted proxy", () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      const req = requestWith({ "x-forwarded-for": "203.0.113.9" });

      expect(clientIp(req)).toBe("203.0.113.9");
    });

    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario The client prepends a forged address and the proxy appends the real one
     * @expectedOutput The forged prefix is discarded; the limiter key cannot be
     *                 chosen by the caller
     */
    it("should discard client-supplied leading hops", () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      // Attacker sends "1.2.3.4"; the trusted proxy appends the real address.
      const req = requestWith({ "x-forwarded-for": "1.2.3.4, 198.51.100.7" });

      expect(clientIp(req)).toBe("198.51.100.7");
    });

    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario Two proxies sit in front of the app
     * @expectedOutput The second-from-last hop, matching the configured depth
     */
    it("should honour a two-hop proxy chain when configured", () => {
      process.env.TRUSTED_PROXY_HOPS = "2";
      const req = requestWith({ "x-forwarded-for": "forged, 198.51.100.7, 203.0.113.9" });

      expect(clientIp(req)).toBe("198.51.100.7");
    });

    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario The header carries fewer hops than the configured depth
     * @expectedOutput Returns null — the header cannot be attributed with enough
     *                 confidence, so it must not be used as an identity
     */
    it("should return null when the chain is shorter than the trusted depth", () => {
      process.env.TRUSTED_PROXY_HOPS = "3";
      const req = requestWith({ "x-forwarded-for": "198.51.100.7" });

      expect(clientIp(req)).toBeNull();
    });

    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario The header contains empty segments from proxy chaining
     * @expectedOutput Blank entries are ignored rather than shifting the index
     */
    it("should ignore empty and whitespace-padded segments", () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      const req = requestWith({ "x-forwarded-for": "  , 1.2.3.4 ,, 198.51.100.7 " });

      expect(clientIp(req)).toBe("198.51.100.7");
    });

    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario TRUSTED_PROXY_HOPS is set to a non-numeric or nonsensical value
     * @expectedOutput Falls back to trusting nothing rather than producing NaN
     *                 indexing that could silently return an attacker value
     */
    it("should trust no hop when the configured depth is not a number", () => {
      process.env.TRUSTED_PROXY_HOPS = "not-a-number";
      const req = requestWith({ "x-forwarded-for": "forged, 198.51.100.7" });

      expect(clientIp(req)).toBeNull();
    });

    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario The deployment does not declare how many proxies it has
     * @expectedOutput null. Nothing the client sends is believable until the
     *                 deployment states how many hops to trust, so requests
     *                 share one allowance instead of getting a fresh one per
     *                 forged header.
     */
    it("should trust no hop when the deployment declares no proxy depth", () => {
      const req = requestWith({ "x-forwarded-for": "forged, 198.51.100.7" });

      expect(clientIp(req)).toBeNull();
    });
  });

  describe("platform headers", () => {
    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario A request carries a platform forwarding header
     * @expectedOutput The header is ignored. It is only trustworthy when the
     *                 request actually came through that platform, and nothing
     *                 in the request proves that — on a directly exposed
     *                 deployment it is as forgeable as any other header.
     */
    it("should ignore platform forwarding headers", () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      const req = requestWith({ "x-vercel-forwarded-for": "203.0.113.22" });

      expect(clientIp(req)).toBeNull();
    });

    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario A request carries the Cloudflare connecting address
     * @expectedOutput The header is ignored for the same reason.
     */
    it("should ignore the Cloudflare connecting IP header", () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      const req = requestWith({ "cf-connecting-ip": "203.0.113.33" });

      expect(clientIp(req)).toBeNull();
    });
  });

  describe("unresolvable origins", () => {
    /**
     * @target clientIp
     * @dependencies Request headers
     * @scenario No forwarding headers of any kind are present
     * @expectedOutput Returns null so callers can apply their own fail-closed
     *                 policy instead of silently keying on an empty string
     */
    it("should return null when no forwarding header is present", () => {
      expect(clientIp(requestWith({}))).toBeNull();
    });

    /**
     * @target clientIp
     * @dependencies TRUSTED_PROXY_HOPS env var, Request headers
     * @scenario Only an empty forwarding header is present
     * @expectedOutput Returns null rather than an empty-string key
     */
    it("should return null for a blank forwarding header", () => {
      process.env.TRUSTED_PROXY_HOPS = "1";
      expect(clientIp(requestWith({ "x-forwarded-for": "   " }))).toBeNull();
    });
  });
});

describe("rateLimitKey", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.env.TRUSTED_PROXY_HOPS = "1";
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
  });

  /**
   * @target rateLimitKey
   * @dependencies Request headers
   * @scenario The same client hits the same scope twice
   * @expectedOutput The identical key, so the second request counts against the
   *                 first one's allowance
   */
  it("should produce a stable key for the same client and scope", () => {
    const req = requestWith({ "x-forwarded-for": "198.51.100.7" });

    expect(rateLimitKey(req, "pat:validate")).toBe(rateLimitKey(req, "pat:validate"));
    expect(rateLimitKey(req, "pat:validate")).toContain("198.51.100.7");
  });

  /**
   * @target rateLimitKey
   * @dependencies Request headers
   * @scenario Two different scopes are used by the same client
   * @expectedOutput Different keys, so one flow cannot exhaust the other's
   *                 allowance
   */
  it("should namespace the key by scope", () => {
    const req = requestWith({ "x-forwarded-for": "198.51.100.7" });

    expect(rateLimitKey(req, "pat:validate")).not.toBe(rateLimitKey(req, "pat:signin"));
  });

  /**
   * @target rateLimitKey
   * @dependencies Request headers
   * @scenario The client cannot be attributed
   * @expectedOutput A fixed "unattributed" suffix, so such traffic shares one
   *                 allowance rather than minting a new key per request
   */
  it("should collapse unattributable requests onto one key", () => {
    delete process.env.TRUSTED_PROXY_HOPS;

    expect(rateLimitKey(requestWith({}), "webhook")).toBe("webhook:unattributed");
    expect(rateLimitKey(undefined, "webhook")).toBe("webhook:unattributed");
  });
});
