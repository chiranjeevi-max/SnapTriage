# Security Overview

SnapTriage handles sensitive access tokens for GitHub and GitLab, as well as triage data.

## Authentication & Tokens

SnapTriage supports two ways to authenticate:
1. **OAuth Applications**: Standard OAuth 2.0 flow. Access tokens are provided by the identity provider.
2. **Personal Access Tokens (PAT)**: Used as a fallback or for strict environments.

### Token Encryption at Rest

Any access tokens (both OAuth and PAT) are encrypted at rest in the database using AES-256-GCM. 
- The encryption key is derived using PBKDF2-HMAC-SHA256 from the `AUTH_SECRET` environment variable and a fixed application salt.
- Each encrypted payload includes a unique initialization vector (IV) and an authentication tag, so tampering is detected on decrypt.
- In case of key rotation, legacy decryption fallbacks are available if configured properly.

## Rate Limiting

To protect the PAT login endpoint from brute-force attacks, SnapTriage rate-limits attempts by IP.
- Limits a single IP to 5 attempts (successful or failed) within a 15-minute window.
- Counters live in the shared `rate_limit_bucket` table, so the limit holds across app instances, and expired rows are purged on each check.
- If the database is unreachable, it falls back to an in-memory limiter with a capped map size, so protection stays on.

## Security Headers (Content Security Policy)

SnapTriage enforces strict HTTP response headers via `next.config.ts`:
- **Content-Security-Policy**: Prevents execution of unauthorized scripts. Issue bodies can contain attacker-controlled HTML, so CSP is the main XSS defense.
- **X-Frame-Options: DENY**: Prevents clickjacking by disabling embedding in iframes.
- **X-Content-Type-Options: nosniff**: Prevents MIME-type confusion attacks.
- **Referrer-Policy**: Set to `strict-origin-when-cross-origin`.
- **Strict-Transport-Security (HSTS)**: Ensures all connections run over HTTPS.

## Logging & Monitoring

- Uses `pino` for structured JSON logging.
- Sensitive information (such as tokens or passwords) is never logged.
- Failed authentication attempts log the IP and provider for anomaly detection.
