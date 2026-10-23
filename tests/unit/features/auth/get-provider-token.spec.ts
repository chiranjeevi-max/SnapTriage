/**
 * @module tests/unit/features/auth/get-provider-token.spec.ts
 * Unit tests for the provider token resolution module.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { typedDb } from "@/lib/db/query";
import { decrypt } from "@/lib/crypto";

// RCS-001: vi.mock for standalone module functions
vi.mock("@/lib/crypto", () => {
  // Mirrors the real module: an unusable stored value surfaces as a
  // TokenDecryptionError, which getProviderToken is expected to absorb.
  class TokenDecryptionError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "TokenDecryptionError";
    }
  }
  return {
    decrypt: vi.fn((v: string) => `decrypted:${v}`),
    TokenDecryptionError,
  };
});

vi.mock("@/lib/db/query", () => {
  return {
    typedDb: {
      select: vi.fn(),
    },
  };
});

vi.mock("@/lib/logger", () => ({
  authLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { authLogger } = await import("@/lib/logger");

// Helper: build a chainable select mock returning a given value
function mockSelect(rows: unknown[]) {
  const whereSpy = vi.fn().mockResolvedValue(rows);
  const fromSpy = vi.fn().mockReturnValue({ where: whereSpy });
  vi.mocked(typedDb.select).mockReturnValue({ from: fromSpy } as never);
  return { fromSpy, whereSpy };
}

describe("getProviderToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks() resets recorded calls but does NOT drain queued
    // `mockReturnValueOnce` implementations. A test that exits early (for
    // example when getProviderToken rejects) leaves its unconsumed responses
    // behind, which then shifts the call sequence for every later test and
    // lets assertions pass for the wrong reason. Drain both queues explicitly.
    vi.mocked(typedDb.select).mockReset();
    vi.mocked(decrypt).mockReset();
    vi.mocked(decrypt).mockImplementation((v: string) => `decrypted:${v}`);
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
      vi.mocked(typedDb.select).mockReturnValueOnce({ from: fromSpy1 } as never);

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
        .mockReturnValueOnce({ from: fromSpy1 } as never)
        .mockReturnValueOnce({ from: fromSpy2 } as never);

      const result = await getProviderToken("USR-001", "github");

      expect(decrypt).toHaveBeenCalledWith("pat_token_hex");
      expect(result).toEqual("decrypted:pat_token_hex");
    });

    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked), decrypt (mocked)
     * @scenario OAuth token exists with no expires_at (long-lived classic token)
     * @expectedOutput Returns the decrypted OAuth token directly
     */
    it("should return OAuth token when expires_at is null (long-lived token)", async () => {
      mockSelect([{ access_token: "classic_token_hex", expires_at: null }]);

      const result = await getProviderToken("USR-001", "github");

      expect(decrypt).toHaveBeenCalledWith("classic_token_hex");
      expect(result).toEqual("decrypted:classic_token_hex");
    });

    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked), decrypt (mocked)
     * @scenario Two accounts are linked for the same provider and the first
     *           one's token cannot be decrypted
     * @expectedOutput The second account's token is used. One unusable account
     *                 must not lock the user out of the provider.
     */
    it("should use the next linked account when the first token is unusable", async () => {
      const { TokenDecryptionError } = await import("@/lib/crypto");

      const makeSelect = (rows: unknown[]) => {
        const whereSpy = vi.fn().mockResolvedValue(rows);
        return { from: vi.fn().mockReturnValue({ where: whereSpy }) } as never;
      };

      vi.mocked(typedDb.select).mockReturnValueOnce(
        makeSelect([
          { access_token: "corrupt_oauth", expires_at: null },
          { access_token: "good_oauth", expires_at: null },
        ])
      );

      vi.mocked(decrypt).mockImplementationOnce(() => {
        throw new TokenDecryptionError("failed authentication");
      });

      const result = await getProviderToken("USR-001", "github");

      expect(result).toEqual("decrypted:good_oauth");
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
        .mockReturnValueOnce({ from: fromSpy1 } as never)
        .mockReturnValueOnce({ from: fromSpy2 } as never);

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
        return { from: fromSpy } as never;
      };

      vi.mocked(typedDb.select)
        .mockReturnValueOnce(makeEmpty())
        .mockReturnValueOnce(makeEmpty());

      const result = await getProviderToken("USR-001", "github");

      expect(result).toBeNull();
    });
  });

  describe("undecryptable stored tokens", () => {
    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked), decrypt (mocked to throw TokenDecryptionError)
     * @scenario An OAuth token is stored but cannot be decrypted
     * @expectedOutput Returns null so the caller prompts for re-authentication,
     *                 rather than propagating the error into an unhandled 500
     */
    it("should return null instead of throwing when the OAuth token cannot be decrypted", async () => {
      const { TokenDecryptionError } = await import("@/lib/crypto");

      const makeSelect = (rows: unknown[]) => {
        const whereSpy = vi.fn().mockResolvedValue(rows);
        return { from: vi.fn().mockReturnValue({ where: whereSpy }) } as never;
      };

      vi.mocked(typedDb.select)
        .mockReturnValueOnce(makeSelect([{ access_token: "corrupt_oauth", expires_at: null }]))
        .mockReturnValueOnce(makeSelect([]));

      vi.mocked(decrypt).mockImplementationOnce(() => {
        throw new TokenDecryptionError("failed authentication");
      });

      await expect(getProviderToken("USR-001", "github")).resolves.toBeNull();
    });

    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked), decrypt (mocked to throw TokenDecryptionError)
     * @scenario A stored PAT cannot be decrypted
     * @expectedOutput Returns null rather than throwing
     */
    it("should return null instead of throwing when the PAT cannot be decrypted", async () => {
      const { TokenDecryptionError } = await import("@/lib/crypto");

      const makeSelect = (rows: unknown[]) => {
        const whereSpy = vi.fn().mockResolvedValue(rows);
        return { from: vi.fn().mockReturnValue({ where: whereSpy }) } as never;
      };

      vi.mocked(typedDb.select)
        .mockReturnValueOnce(makeSelect([]))
        .mockReturnValueOnce(makeSelect([{ token: "corrupt_pat" }]));

      vi.mocked(decrypt).mockImplementationOnce(() => {
        throw new TokenDecryptionError("failed authentication");
      });

      await expect(getProviderToken("USR-001", "gitlab")).resolves.toBeNull();
    });

    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked), decrypt (mocked)
     * @scenario decrypt raises an error that is not a TokenDecryptionError
     * @expectedOutput The error propagates. Only errors this module can explain
     *                 as "stored token unusable" should be absorbed; anything
     *                 else indicates a real fault and must stay visible.
     */
    it("should rethrow unexpected decryption errors", async () => {
      const makeSelect = (rows: unknown[]) => {
        const whereSpy = vi.fn().mockResolvedValue(rows);
        return { from: vi.fn().mockReturnValue({ where: whereSpy }) } as never;
      };

      vi.mocked(typedDb.select)
        .mockReturnValueOnce(makeSelect([]))
        .mockReturnValueOnce(makeSelect([{ token: "weird_pat" }]));

      vi.mocked(decrypt).mockImplementationOnce(() => {
        throw new TypeError("something unrelated broke");
      });

      await expect(getProviderToken("USR-001", "github")).rejects.toThrow(TypeError);
    });

    /**
     * @target getProviderToken
     * @dependencies typedDb.select (mocked), decrypt (mocked), authLogger (mocked)
     * @scenario A stored token cannot be decrypted
     * @expectedOutput A warning is recorded with the user and provider, so an
     *                 operator can see which integration lost its credential.
     *                 Only identity context, never the token value.
     */
    it("should log an unusable stored token without leaking the value", async () => {
      const { TokenDecryptionError } = await import("@/lib/crypto");

      const makeSelect = (rows: unknown[]) => {
        const whereSpy = vi.fn().mockResolvedValue(rows);
        return { from: vi.fn().mockReturnValue({ where: whereSpy }) } as never;
      };

      vi.mocked(typedDb.select)
        .mockReturnValueOnce(makeSelect([]))
        .mockReturnValueOnce(makeSelect([{ token: "corrupt_pat_value" }]));

      vi.mocked(decrypt).mockImplementationOnce(() => {
        throw new TokenDecryptionError("failed authentication");
      });

      await getProviderToken("USR-001", "github");

      expect(authLogger.warn).toHaveBeenCalledWith(
        { userId: "USR-001", provider: "github" },
        expect.stringContaining("could not be decrypted")
      );
      const loggedArgs = JSON.stringify(vi.mocked(authLogger.warn).mock.calls);
      expect(loggedArgs).not.toContain("corrupt_pat_value");
    });
  });
});
