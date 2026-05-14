import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCipheriv, randomBytes, pbkdf2Sync } from 'crypto';

describe('crypto lib', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...OLD_ENV };
    process.env.AUTH_SECRET = 'test-secret-key-12345678901234567890';
    process.env.AUTH_SALT = 'test-salt';
  });

  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('should encrypt and decrypt successfully with the current key', async () => {
    const { encrypt, decrypt } = await import('../../src/lib/crypto');
    const plaintext = 'my-sensitive-token';
    const encrypted = encrypt(plaintext);

    // Check format
    expect(encrypted.split(':').length).toBe(3);

    // Decrypt
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('should fallback to legacy key for old encrypted data', async () => {
    const { decrypt } = await import('../../src/lib/crypto');
    const plaintext = 'old-sensitive-token';

    // Generate an encrypted string using the legacy 100_000 iterations logic
    // Need to use the same salt the module uses! Since we set process.env.AUTH_SALT = 'test-salt' before import,
    // the module will use 'test-salt'.
    const legacyKey = pbkdf2Sync(
      process.env.AUTH_SECRET as string,
      'test-salt',
      100_000,
      32,
      'sha256'
    );

    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', legacyKey, iv);

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    const legacyEncryptedString = `${iv.toString('hex')}:${authTag}:${ciphertext}`;

    // Now try to decrypt it using the current decrypt function
    const decrypted = decrypt(legacyEncryptedString);
    expect(decrypted).toBe(plaintext);
  });

  it('should return plaintext for unencrypted legacy tokens', async () => {
    const { decrypt } = await import('../../src/lib/crypto');
    const plaintext = 'unencrypted-token';
    expect(decrypt(plaintext)).toBe(plaintext);
  });

  it('should throw an error if AUTH_SECRET is not set', async () => {
    delete process.env.AUTH_SECRET;
    const { encrypt } = await import('../../src/lib/crypto');
    expect(() => encrypt('test')).toThrow('AUTH_SECRET is required');
  });

  it('should fail decryption if data is tampered with', async () => {
    const { encrypt, decrypt } = await import('../../src/lib/crypto');
    const encrypted = encrypt('sensitive');
    const parts = encrypted.split(':');

    // Tamper with ciphertext
    const tamperedCiphertext = parts[2].substring(0, parts[2].length - 2) + '00';
    const tampered = `${parts[0]}:${parts[1]}:${tamperedCiphertext}`;

    expect(() => decrypt(tampered)).toThrow();
  });
});
