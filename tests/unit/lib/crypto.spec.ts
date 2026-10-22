/**
 * @module tests/unit/lib/crypto.spec.ts
 *
 * Unit tests for the AES-256-GCM encryption/decryption module.
 *
 * `decrypt()` is fail-closed by contract: anything that is not a well-formed,
 * authenticable ciphertext raises {@link TokenDecryptionError}. Returning
 * unverified input as if it were a plaintext token is the bug this module
 * previously had, so each rejection path below has its own test.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createCipheriv, randomBytes, pbkdf2Sync } from "node:crypto";
import { encrypt, decrypt, TokenDecryptionError } from "@/lib/crypto";

describe("crypto", () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    // The derived key is cached in module scope, so reset the module registry
    // whenever the environment is manipulated between tests.
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
     * @expectedOutput A `v1:`-prefixed string of 3 hex segments (v1:iv:authTag:ciphertext)
     */
    it("should return a versioned v1:iv:authTag:ciphertext string", () => {
      const result = encrypt("ghp_supersecrettoken");

      const parts = result.split(":");
      expect(parts).toHaveLength(4);
      // The version tag is a literal, not ciphertext.
      expect(parts[0]).toBe("v1");
      for (const part of parts.slice(1)) {
        expect(part).toMatch(/^[0-9a-f]+$/);
      }
    });

    /**
     * @target encrypt
     * @dependencies Node crypto (native)
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
      expect(decrypt(encrypt(plaintext))).toEqual(plaintext);
    });

    /**
     * @target decrypt
     * @dependencies Node crypto (native)
     * @scenario Plaintext is empty, producing a zero-length ciphertext segment
     * @expectedOutput Round-trips cleanly; an empty segment is valid GCM output,
     *                 not a malformed record
     */
    it("should round-trip an empty string", () => {
      expect(decrypt(encrypt(""))).toEqual("");
    });

    /**
     * @target decrypt
     * @dependencies None
     * @scenario A bare legacy plaintext token with no version prefix is passed in
     * @expectedOutput Throws TokenDecryptionError rather than echoing the input
     *                 back to the caller as if it were a usable credential
     */
    it("should reject an unversioned legacy plaintext token", () => {
      expect(() => decrypt("gho_plainLegacyToken")).toThrow(TokenDecryptionError);
    });

    /**
     * @target decrypt
     * @dependencies None
     * @scenario A versioned string whose segment count does not match the format
     * @expectedOutput Throws TokenDecryptionError — a truncated or padded record
     *                 is malformed, not a plaintext fallback
     */
    it("should reject a versioned string with the wrong number of segments", () => {
      expect(() => decrypt("v1:only:two")).toThrow(TokenDecryptionError);
    });

    /**
     * @target decrypt
     * @dependencies None
     * @scenario Segment contents are not valid hex
     * @expectedOutput Throws TokenDecryptionError before any cipher work is attempted,
     *                 because Buffer.from(x, "hex") silently truncates non-hex input
     */
    it("should reject a record containing non-hex characters", () => {
      const [, iv, tag, ciphertext] = encrypt("token").split(":");
      expect(() => decrypt(`v1:${iv}:${tag}:${ciphertext.slice(0, -2)}zz`)).toThrow(
        TokenDecryptionError
      );
    });

    /**
     * @target decrypt
     * @dependencies None
     * @scenario The IV is present and hex but not 16 bytes long
     * @expectedOutput Throws TokenDecryptionError instead of letting createDecipheriv
     *                 raise an opaque error
     */
    it("should reject a record with a malformed IV length", () => {
      const [, , tag, ciphertext] = encrypt("token").split(":");
      expect(() => decrypt(`v1:abcd:${tag}:${ciphertext}`)).toThrow(TokenDecryptionError);
    });

    /**
     * @target decrypt
     * @dependencies None
     * @scenario The auth tag is present and hex but not 16 bytes long
     * @expectedOutput Throws TokenDecryptionError
     */
    it("should reject a record with a malformed auth tag length", () => {
      const [, iv, , ciphertext] = encrypt("token").split(":");
      expect(() => decrypt(`v1:${iv}:abcd:${ciphertext}`)).toThrow(TokenDecryptionError);
    });

    /**
     * @target decrypt
     * @dependencies Node crypto (native)
     * @scenario An entirely empty stored value
     * @expectedOutput Throws TokenDecryptionError; never resolves to ""
     */
    it("should reject an empty stored value", () => {
      expect(() => decrypt("")).toThrow(TokenDecryptionError);
    });

    /**
     * @target decrypt
     * @dependencies Node crypto (native)
     * @scenario The ciphertext part of the encrypted string has been modified
     * @expectedOutput Throws a TokenDecryptionError due to authTag mismatch
     *                 (AES-GCM integrity check)
     */
    it("should throw if the ciphertext is tampered with", () => {
      const [, iv, authTag, ciphertext] = encrypt("super_secret_data").split(":");
      const tampered = `${ciphertext.slice(0, -1)}${ciphertext.endsWith("0") ? "1" : "0"}`;

      expect(() => decrypt(`v1:${iv}:${authTag}:${tampered}`)).toThrow(TokenDecryptionError);
    });

    /**
     * @target decrypt
     * @dependencies Node crypto (native)
     * @scenario The authTag part of the encrypted string has been modified
     * @expectedOutput Throws a TokenDecryptionError due to authTag mismatch
     */
    it("should throw if the authTag is tampered with", () => {
      const [, iv, authTag, ciphertext] = encrypt("super_secret_data").split(":");
      const tampered = `${authTag.slice(0, -1)}${authTag.endsWith("0") ? "1" : "0"}`;

      expect(() => decrypt(`v1:${iv}:${tampered}:${ciphertext}`)).toThrow(TokenDecryptionError);
    });

    /**
     * @target decrypt
     * @dependencies Node crypto (native)
     * @scenario The iv part of the encrypted string has been modified
     * @expectedOutput Throws a TokenDecryptionError due to authTag mismatch
     */
    it("should throw if the iv is tampered with", () => {
      const [, iv, authTag, ciphertext] = encrypt("super_secret_data").split(":");
      const tampered = `${iv.slice(0, -1)}${iv.endsWith("0") ? "1" : "0"}`;

      expect(() => decrypt(`v1:${tampered}:${authTag}:${ciphertext}`)).toThrow(TokenDecryptionError);
    });

    /**
     * @target decrypt
     * @dependencies Node crypto (native), both derived keys
     * @scenario A well-formed record encrypted under neither known key
     * @expectedOutput Throws TokenDecryptionError naming both attempts rather than
     *                 propagating an opaque cipher error from the legacy fallback
     */
    it("should throw when no known key can authenticate the record", async () => {
      const [, iv, authTag, ciphertext] = encrypt("super_secret_data").split(":");

      vi.resetModules();
      process.env = { ...ORIGINAL_ENV, AUTH_SECRET: "a-completely-different-secret-value!" };
      const { decrypt: decryptWithOtherSecret } = await import("@/lib/crypto");

      // Asserted by message rather than `instanceof`: re-importing after
      // resetModules yields a second TokenDecryptionError class, so class
      // identity is not comparable across the two module instances.
      expect(() => decryptWithOtherSecret(`v1:${iv}:${authTag}:${ciphertext}`)).toThrow(
        /failed authentication/
      );
    });
  });

  describe("AUTH_SALT", () => {
    /**
     * @target crypto module initialisation
     * @dependencies AUTH_SALT env var
     * @scenario AUTH_SALT is present but empty — the shape produced by copying
     *           `.env.example` verbatim
     * @expectedOutput Module init throws, so a silently inactive salt cannot be
     *                 mistaken for a configured one
     */
    it("should refuse to derive a key when AUTH_SALT is set but empty", async () => {
      vi.resetModules();
      process.env = {
        ...ORIGINAL_ENV,
        AUTH_SECRET: "test-secret-32-chars-long-enough!!",
        AUTH_SALT: "",
      };

      // The module itself still loads: a misconfigured salt must not take
      // every unrelated route down. The failure is raised when a key is
      // actually derived.
      const fresh = await import("@/lib/crypto");
      expect(() => fresh.encrypt("token")).toThrow(/AUTH_SALT/);
    });

    /**
     * @target crypto module initialisation
     * @dependencies AUTH_SALT env var
     * @scenario AUTH_SALT is absent entirely
     * @expectedOutput Module loads normally against the built-in default salt
     */
    it("should fall back to the default salt when AUTH_SALT is unset", async () => {
      vi.resetModules();
      process.env = { ...ORIGINAL_ENV, AUTH_SECRET: "test-secret-32-chars-long-enough!!" };
      delete process.env.AUTH_SALT;

      const fresh = await import("@/lib/crypto");
      expect(fresh.decrypt(fresh.encrypt("token"))).toBe("token");
    });
  });

  describe("records written before the version prefix existed", () => {
    /**
     * @target decrypt
     * @dependencies Node crypto (native)
     * @scenario A record stored in the old `iv:authTag:ciphertext` layout,
     *           encrypted with the current work factor
     * @expectedOutput The plaintext is returned. Tokens stored by earlier
     *                 versions must stay usable, or every user is silently
     *                 logged out of their provider connection.
     */
    it("should decrypt an unversioned record written with the current key", async () => {
      const secret = "test-secret-32-chars-long-enough!!";
      const key = pbkdf2Sync(secret, "snaptriage-token-encryption-v1", 600_000, 32, "sha256");
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = cipher.update("legacy-token", "utf8", "hex") + cipher.final("hex");
      const legacy = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${body}`;

      expect(decrypt(legacy)).toBe("legacy-token");
    });

    /**
     * @target decrypt
     * @dependencies Node crypto (native)
     * @scenario A record stored in the old layout and encrypted with the
     *           pre-bump PBKDF2 work factor
     * @expectedOutput The plaintext is returned — the legacy key is still a
     *                 candidate for records that carry no version tag.
     */
    it("should decrypt an unversioned record written with the legacy work factor", async () => {
      const secret = "test-secret-32-chars-long-enough!!";
      const key = pbkdf2Sync(secret, "snaptriage-token-encryption-v1", 100_000, 32, "sha256");
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = cipher.update("old-token", "utf8", "hex") + cipher.final("hex");
      const legacy = `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${body}`;

      expect(decrypt(legacy)).toBe("old-token");
    });

    /**
     * @target decrypt
     * @dependencies None
     * @scenario A versioned record that no known key can authenticate
     * @expectedOutput TokenDecryptionError. The version tag pins the work
     *                 factor, so the legacy key is not tried for it.
     */
    it("should not fall back to the legacy key for a versioned record", async () => {
      const secret = "test-secret-32-chars-long-enough!!";
      const key = pbkdf2Sync(secret, "snaptriage-token-encryption-v1", 100_000, 32, "sha256");
      const iv = randomBytes(16);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = cipher.update("mismatched", "utf8", "hex") + cipher.final("hex");
      const record = `v1:${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${body}`;

      expect(() => decrypt(record)).toThrow(TokenDecryptionError);
    });
  });
});