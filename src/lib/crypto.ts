/**
 * @module lib/crypto
 *
 * AES-256-GCM encryption/decryption for sensitive data at rest.
 * Used to encrypt Personal Access Tokens before storing them in the database.
 *
 * The encryption key is derived from `AUTH_SECRET` using PBKDF2 with an
 * application-level salt. Each encrypted value gets its own random IV.
 *
 * Stored format: `v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 *
 * Records written before the version prefix existed use the bare
 * `<iv_hex>:<authTag_hex>:<ciphertext_hex>` layout. They are still readable:
 * the shape selects the key candidates, the prefix stays the primary
 * discriminator for anything written from now on.
 *
 * Decryption is fail-closed by design. `AUTH_SECRET` is the only secret
 * standing between a database dump and a live credential, so {@link decrypt}
 * never returns a value it has not authenticated. Malformed input raises
 * {@link TokenDecryptionError} instead of being echoed back as though it were
 * a plaintext token.
 */
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync } from "crypto";

/** AES-GCM cipher used for every stored secret. */
const CIPHER = "aes-256-gcm";

/** Record version prefix. Bump the tag rather than inferring a format from value shape. */
const FORMAT_PREFIX = "v1:";

/** Salt used when the deployment does not configure its own. */
const DEFAULT_SALT = "snaptriage-token-encryption-v1";

/** GCM parameters. Both the IV and the auth tag are 16 bytes for this cipher. */
const IV_BYTES = 16;
const AUTH_TAG_BYTES = 16;

/** PBKDF2 work factors. The current count matches the OWASP recommendation for PBKDF2-HMAC-SHA256. */
const CURRENT_ITERATIONS = 600_000;

/** Work factor used by tokens encrypted before the iteration count was raised. */
const LEGACY_ITERATIONS = 100_000;

/**
 * Raised when a stored value cannot be decrypted.
 *
 * Callers should treat this as "the stored credential is unusable" and prompt
 * the user to re-authenticate. It must never be swallowed and downgraded to a
 * plaintext fallback.
 */
export class TokenDecryptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenDecryptionError";
  }
}

/**
 * Resolves the PBKDF2 salt.
 *
 * An explicitly empty `AUTH_SALT` is treated as a misconfiguration rather than
 * as "unset": `AUTH_SALT=` is what `.env.example` used to copy into a working
 * setup, and letting `||` collapse that to the shared built-in default would
 * quietly drop the per-deployment key separation the variable exists to
 * provide.
 *
 * The check runs when a key is derived, not when this module is imported: a
 * misconfigured salt must break token handling, but it must not take every
 * unrelated route in the app down with it.
 *
 * @throws {Error} If `AUTH_SALT` is set but empty.
 */
function resolveSalt(): string {
  const configured = process.env.AUTH_SALT;

  if (configured !== undefined && configured.trim() === "") {
    throw new Error(
      "AUTH_SALT is set but empty. Generate one with `openssl rand -base64 32`, " +
        "or remove the variable entirely to use the built-in default."
    );
  }

  return configured?.trim() || DEFAULT_SALT;
}

/**
 * Derived keys are cached in module scope. PBKDF2 at the current work factor is
 * deliberately expensive, and the inputs cannot change within a process lifetime.
 */
let _cachedSalt: string | null = null;
let _cachedKey: Buffer | null = null;
let _cachedLegacyKey: Buffer | null = null;

function deriveKey(iterations: number): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is required for token encryption");
  }
  _cachedSalt ??= resolveSalt();
  return pbkdf2Sync(secret, _cachedSalt, iterations, 32, "sha256");
}

/**
 * Returns the key used to encrypt new values.
 * @returns The 32-byte derived encryption key.
 */
function getEncryptionKey(): Buffer {
  _cachedKey ??= deriveKey(CURRENT_ITERATIONS);
  return _cachedKey;
}

/**
 * Returns the key used to decrypt values written before the work factor was raised.
 * Retained because those records are still readable with the same `AUTH_SECRET`.
 * @returns The 32-byte derived legacy encryption key.
 */
function getLegacyEncryptionKey(): Buffer {
  _cachedLegacyKey ??= deriveKey(LEGACY_ITERATIONS);
  return _cachedLegacyKey;
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 *
 * @param plaintext - The sensitive value to encrypt (e.g., a PAT).
 * @returns Encrypted string as `v1:iv:authTag:ciphertext`, hex-encoded apart from the version tag.
 */
export function encrypt(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv);

  const body = cipher.update(plaintext, "utf8", "hex") + cipher.final("hex");

  return `${FORMAT_PREFIX}${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${body}`;
}

/** A parsed, structurally valid stored record. Structural validity is not authenticity. */
interface ParsedRecord {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: string;
  /** Whether the record carries the current version prefix. */
  versioned: boolean;
}

const HEX_SEGMENT = /^[0-9a-f]+$/i;

/**
 * Parses a stored value into its segments, rejecting anything that is not a
 * well-formed record.
 *
 * Validation happens up front rather than being left to `Buffer.from(.., "hex")`,
 * which silently truncates odd-length or non-hex input. A bad record would then
 * reach the cipher as a shorter key or tag instead of being reported as corrupt.
 *
 * @param stored - The raw database value.
 * @returns The decoded record.
 * @throws {TokenDecryptionError} If the value is not a well-formed record.
 */
function parseRecord(stored: unknown): ParsedRecord {
  if (typeof stored !== "string" || stored.length === 0) {
    throw new TokenDecryptionError("Stored token is empty or not a string");
  }

  // Records written before the version prefix existed hold the same three
  // segments without the leading tag. Both shapes are accepted so tokens
  // stored by earlier versions stay readable.
  const versioned = stored.startsWith(FORMAT_PREFIX);
  const body = versioned ? stored.slice(FORMAT_PREFIX.length) : stored;

  const segments = body.split(":");
  if (segments.length !== 3) {
    throw new TokenDecryptionError("Stored token has a malformed segment count");
  }

  const [ivHex, authTagHex, ciphertext] = segments;

  // An empty ciphertext is legitimate. Encrypting "" yields a bare auth tag,
  // but every other segment must carry hex content.
  if (!HEX_SEGMENT.test(ivHex) || !HEX_SEGMENT.test(authTagHex)) {
    throw new TokenDecryptionError("Stored token contains non-hex segments");
  }
  if (ciphertext !== "" && !HEX_SEGMENT.test(ciphertext)) {
    throw new TokenDecryptionError("Stored token contains a non-hex ciphertext");
  }
  // An odd number of hex digits would be silently truncated by the decoder.
  if (ciphertext.length % 2 !== 0) {
    throw new TokenDecryptionError("Stored token has a malformed ciphertext length");
  }

  if (ivHex.length !== IV_BYTES * 2) {
    throw new TokenDecryptionError("Stored token has a malformed IV length");
  }
  if (authTagHex.length !== AUTH_TAG_BYTES * 2) {
    throw new TokenDecryptionError("Stored token has a malformed auth tag length");
  }

  return {
    iv: Buffer.from(ivHex, "hex"),
    authTag: Buffer.from(authTagHex, "hex"),
    ciphertext,
    versioned,
  };
}

/**
 * Decrypts a value produced by {@link encrypt}.
 *
 * Every key that could have produced the record is tried before giving up, so
 * tokens stored before the PBKDF2 work factor was raised remain readable. A
 * value that none of them can authenticate is reported as an error. It is
 * never returned as-is.
 *
 * @param stored - The stored value, either `v1:iv:authTag:ciphertext` or the
 *                 older `iv:authTag:ciphertext` layout.
 * @returns The original plaintext string.
 * @throws {TokenDecryptionError} If the value is malformed or fails authentication.
 */
export function decrypt(stored: string): string {
  const { iv, authTag, ciphertext, versioned } = parseRecord(stored);

  const attempt = (key: Buffer): string => {
    const decipher = createDecipheriv(CIPHER, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(ciphertext, "hex", "utf8") + decipher.final("utf8");
  };

  // A versioned record can only have been written with the current work
  // factor. An unversioned one may predate the iteration bump, so the legacy
  // key is a candidate for it as well; derived only when it is actually
  // needed, because the derivation is deliberately expensive.
  try {
    return attempt(getEncryptionKey());
  } catch {
    // Wrong key or tampered ciphertext. Fall through to the next candidate;
    // exhausting them raises a single typed error below.
  }

  if (!versioned) {
    try {
      return attempt(getLegacyEncryptionKey());
    } catch {
      // Same as above: the legacy key did not authenticate this record either.
    }
  }

  throw new TokenDecryptionError("Stored token failed authentication with every known key");
}
