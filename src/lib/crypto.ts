/**
 * @module lib/crypto
 *
 * AES-256-GCM encryption/decryption for sensitive data at rest.
 * Used to encrypt Personal Access Tokens before storing them in the database.
 *
 * The encryption key is derived from `AUTH_SECRET` using PBKDF2 with a
 * fixed application-level salt. Each encrypted value gets its own random IV.
 *
 * Format: `iv_hex:authTag_hex:ciphertext_hex`
 */
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "crypto";

/** Application salt — combined with AUTH_SECRET to derive the encryption key.
 * Allows configuring AUTH_SALT for improved security, falling back to legacy salt.
 */
const APP_SALT = process.env.AUTH_SALT || "snaptriage-token-encryption-v1";

/**
 * Derives a 256-bit encryption key from AUTH_SECRET using PBKDF2.
 * Caches the result in module scope for performance.
 */
let _cachedKey: Buffer | null = null;
function getEncryptionKey(): Buffer {
  if (_cachedKey) return _cachedKey;

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required for token encryption");
  }

  _cachedKey = pbkdf2Sync(secret, APP_SALT, 100_000, 32, "sha256");
  return _cachedKey;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The sensitive value to encrypt (e.g., a PAT).
 * @returns Encrypted string in format `iv:authTag:ciphertext` (all hex-encoded).
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");

  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a value that was encrypted with {@link encrypt}.
 *
 * @param encryptedValue - The encrypted string in `iv:authTag:ciphertext` format.
 * @returns The original plaintext string.
 * @throws If the value is malformed or the auth tag doesn't match.
 */
export function decrypt(encryptedValue: string): string {
  // Handle legacy unencrypted tokens (no colons = plaintext)
  if (!encryptedValue.includes(":")) {
    return encryptedValue;
  }

  const parts = encryptedValue.split(":");
  if (parts.length !== 3) {
    // Not in expected format — treat as plaintext (legacy token)
    return encryptedValue;
  }

  const [ivHex, authTagHex, ciphertext] = parts;

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
