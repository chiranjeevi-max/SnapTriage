🎯 **What:**
Upgraded the PBKDF2 iteration count from 100,000 to 600,000 for token encryption to meet current OWASP standards for PBKDF2-HMAC-SHA256. Added backward compatibility to decrypt older tokens that were encrypted using the 100,000 iteration key. Fixed a minor pre-existing type check error in `sync-engine.ts` (`inferSelectModel` -> `InferSelectModel`).

⚠️ **Risk:**
If left unfixed, the lower iteration count makes the application susceptible to offline brute-force attacks against encrypted data if the database and `APP_SALT` were compromised. 100,000 iterations is below modern security recommendations as hardware speeds increase.

🛡️ **Solution:**
Updated `src/lib/crypto.ts` to use 600,000 iterations for newly generated encryption keys. Implemented a fallback mechanism inside the `decrypt` function by wrapping the AES-GCM decipher operation in a `try/catch` block. If the auth tag validation fails (which indicates an incorrect key, such as applying the 600k key to a 100k-encrypted token), it falls back and attempts to decrypt using the legacy 100,000 iterations key. Added unit tests to `tests/unit/crypto.test.ts` to ensure functionality and safe fallbacks.
