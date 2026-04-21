/**
 * @module tests/unit/features/auth/get-provider-token.spec.ts
 * Unit tests for the provider token resolution module.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { typedDb } from "@/lib/db/query";
import { decrypt } from "@/lib/crypto";

// RCS-001: vi.mock for standalone module functions
vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
}));

vi.mock("@/lib/db/query", () => {
  return {
    typedDb: {
      select: vi.fn(),
    },
  };
});

// Helper: build a chainable select mock returning a given value
function mockSelect(rows: unknown[]) {
  const whereSpy = vi.fn().mockResolvedValue(rows);
  const fromSpy = vi.fn().mockReturnValue({ where: whereSpy });
  vi.mocked(typedDb.select).mockReturnValue({ from: fromSpy } as any);
  return { fromSpy, whereSpy };
}

describe("getProviderToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("OAuth token path", () => {
    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked), decrypt (mocked)
     * @scenario A valid non-expired OAuth account token exists
     * @expectedOutput The decrypted OAuth access_token is returned
     */
    it("should return a decrypted OAuth token when one exists and is not expired", async () => {
      const futureExpiry = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now

      // First select call → accounts table
      const whereSpy1 = vi.fn().mockResolvedValue([
        { access_token: "oauth_token_hex", expires_at: futureExpiry },
      ]);
      const fromSpy1 = vi.fn().mockReturnValue({ where: whereSpy1 });
      vi.mocked(typedDb.select).mockReturnValueOnce({ from: fromSpy1 } as any);

      const result = await getProviderToken("USR-001", "github");

      expect(decrypt).toHaveBeenCalledWith("oauth_token_hex");
      expect(result).toEqual("decrypted:oauth_token_hex");
    });

    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked)
     * @scenario OAuth token exists but has expired
     * @expectedOutput Falls through to PAT lookup; returns PAT when found
     */
    it("should fall through to PAT when OAuth token is expired", async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 60; // expired 1 min ago

      // First select call → accounts (expired token)
      const whereSpy1 = vi.fn().mockResolvedValue([
        { access_token: "expired_token", expires_at: pastExpiry },
      ]);
      const fromSpy1 = vi.fn().mockReturnValue({ where: whereSpy1 });

      // Second select call → accessTokens (PAT found)
      const whereSpy2 = vi.fn().mockResolvedValue([{ token: "pat_token_hex" }]);
      const fromSpy2 = vi.fn().mockReturnValue({ where: whereSpy2 });

      vi.mocked(typedDb.select)
        .mockReturnValueOnce({ from: fromSpy1 } as any)
        .mockReturnValueOnce({ from: fromSpy2 } as any);

      const result = await getProviderToken("USR-001", "github");

      expect(decrypt).toHaveBeenCalledWith("pat_token_hex");
      expect(result).toEqual("decrypted:pat_token_hex");
    });

    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked)
     * @scenario OAuth token exists with no expires_at (long-lived classic token)
     * @expectedOutput Returns the decrypted OAuth token directly
     */
    it("should return OAuth token when expires_at is null (long-lived token)", async () => {
      mockSelect([{ access_token: "classic_token_hex", expires_at: null }]);

      const result = await getProviderToken("USR-001", "github");

      expect(decrypt).toHaveBeenCalledWith("classic_token_hex");
      expect(result).toEqual("decrypted:classic_token_hex");
    });
  });

  describe("PAT fallback path", () => {
    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked), decrypt (mocked)
     * @scenario No OAuth account, but a PAT exists
     * @expectedOutput Returns the decrypted PAT
     */
    it("should return a decrypted PAT when no OAuth account is present", async () => {
      // First call → no OAuth accounts
      const whereSpy1 = vi.fn().mockResolvedValue([]);
      const fromSpy1 = vi.fn().mockReturnValue({ where: whereSpy1 });

      // Second call → PAT exists
      const whereSpy2 = vi.fn().mockResolvedValue([{ token: "pat_token_hex" }]);
      const fromSpy2 = vi.fn().mockReturnValue({ where: whereSpy2 });

      vi.mocked(typedDb.select)
        .mockReturnValueOnce({ from: fromSpy1 } as any)
        .mockReturnValueOnce({ from: fromSpy2 } as any);

      const result = await getProviderToken("USR-001", "gitlab");

      expect(decrypt).toHaveBeenCalledWith("pat_token_hex");
      expect(result).toEqual("decrypted:pat_token_hex");
    });

    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked)
     * @scenario No OAuth account and no PAT
     * @expectedOutput Returns null
     */
    it("should return null when neither OAuth nor PAT is available", async () => {
      // Both selects return empty arrays
      const makeEmpty = () => {
        const whereSpy = vi.fn().mockResolvedValue([]);
        const fromSpy = vi.fn().mockReturnValue({ where: whereSpy });
        return { from: fromSpy } as any;
      };

      vi.mocked(typedDb.select)
        .mockReturnValueOnce(makeEmpty())
        .mockReturnValueOnce(makeEmpty());

      const result = await getProviderToken("USR-001", "github");

      expect(result).toBeNull();
    });
  });
});
