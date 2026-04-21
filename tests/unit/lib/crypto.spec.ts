/**
 * @module tests/unit/lib/crypto.spec.ts
 * Unit tests for the AES-256-GCM encryption/decryption module.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { encrypt, decrypt } from "@/lib/crypto";

describe("crypto", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // Provide a stable AUTH_SECRET for all tests; reset the key cache between
    // tests by restoring env (the module caches the derived key in module scope,
    // so we re-import after env manipulation where needed).
    vi.resetModules();
    process.env = { ...ORIGINAL_ENV, AUTH_SECRET: "test-secret-32-chars-long-enough!!" };
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    vi.clearAllMocks();
  });

  describe("encrypt", () => {
    /**
     * @target encrypt
     * @dependencies Node crypto (native — not mocked)
     * @scenario Valid plaintext is provided with AUTH_SECRET set
     * @expectedOutput A colon-delimited string of 3 hex segments (iv:authTag:ciphertext)
     */
    it("should return a string in iv:authTag:ciphertext format", () => {
      const result = encrypt("ghp_supersecrettoken");

      const parts = result.split(":");
      expect(parts).toHaveLength(3);
      // Each part must be a non-empty hex string
      for (const part of parts) {
        expect(part).toMatch(/^[0-9a-f]+$/);
      }
    });

    /**
     * @target encrypt
     * @dependencies Node crypto (native), AUTH_SECRET env var
     * @scenario Same plaintext encrypted twice
     * @expectedOutput Two different ciphertexts (random IV ensures non-determinism)
     */
    it("should produce different ciphertexts for the same input (random IV)", () => {
      const first = encrypt("same-token");
      const second = encrypt("same-token");
      expect(first).not.toEqual(second);
    });

    /**
     * @target encrypt
     * @dependencies getEncryptionKey, AUTH_SECRET env var
     * @scenario AUTH_SECRET is missing from environment
     * @expectedOutput Throws an Error (not a specific message — type-based assertion)
     */
    it("should throw when AUTH_SECRET is not set", async () => {
      // Re-import the module without AUTH_SECRET so the key cache is cold
      delete process.env.AUTH_SECRET;
      const { encrypt: freshEncrypt } = await import("@/lib/crypto");
      expect(() => freshEncrypt("token")).toThrowError(Error);
    });
  });

  describe("decrypt", () => {
    /**
     * @target decrypt
     * @dependencies Node crypto (native)
     * @scenario A value previously encrypted with encrypt() is passed in
     * @expectedOutput The original plaintext is returned exactly
     */
    it("should round-trip: decrypt(encrypt(x)) === x", () => {
      const plaintext = "ghp_myPersonalAccessToken123";
      const ciphertext = encrypt(plaintext);
      const result = decrypt(ciphertext);
      expect(result).toEqual(plaintext);
    });

    /**
     * @target decrypt
     * @dependencies None
     * @scenario A legacy plaintext token with no colons is passed in
     * @expectedOutput The original string is returned unchanged (backwards-compat path)
     */
    it("should return legacy tokens without colons as-is", () => {
      const legacyToken = "gho_plainLegacyToken";
      const result = decrypt(legacyToken);
      expect(result).toEqual(legacyToken);
    });

    /**
     * @target decrypt
     * @dependencies None
     * @scenario A string with colons but not exactly 3 parts is passed in
     * @expectedOutput The original string is returned unchanged (malformed fallback)
     */
    it("should return malformed encrypted strings as-is", () => {
      const malformed = "only:two";
      const result = decrypt(malformed);
      expect(result).toEqual(malformed);
    });
  });
});
