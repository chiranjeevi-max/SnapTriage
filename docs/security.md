# Security Overview

SnapTriage handles sensitive access tokens for GitHub and GitLab, as well as triage data. Security is prioritized at every layer of the application.

## Authentication & Tokens

SnapTriage supports two ways to authenticate:
1. **OAuth Applications**: Standard OAuth 2.0 flow. Access tokens are provided by the identity provider.
2. **Personal Access Tokens (PAT)**: Used as a fallback or for strict environments.

### Token Encryption at Rest

Any access tokens (both OAuth and PAT) are **encrypted at rest** in the database using AES-256-GCM. 
- The encryption key is derived using PBKDF2-HMAC-SHA256 from the `AUTH_SECRET` environment variable and a fixed application salt.
- Each encrypted payload includes a unique Initialization Vector (IV) and an Authentication Tag to guarantee data integrity.
- In case of key rotation, legacy decryption fallbacks are available if configured properly.

## Rate Limiting

To protect against brute-force attacks on the PAT login endpoint, an IP-based rate limiter is implemented.
- Limits a single IP address to 5 failed/success attempts within a 15-minute window.
- The rate limiter prevents Out-of-Memory (OOM) conditions by capping the tracking map and actively pruning expired entries.

## Security Headers (Content Security Policy)

SnapTriage enforces strict HTTP response headers via `next.config.ts`:
- **Content-Security-Policy**: Prevents execution of unauthorized scripts and protects against XSS. As a triage tool handling potentially malicious issue bodies, CSP is critical.
- **X-Frame-Options: DENY**: Prevents clickjacking by disabling embedding in iframes.
- **X-Content-Type-Options: nosniff**: Prevents MIME-type confusion attacks.
- **Referrer-Policy**: Set to `strict-origin-when-cross-origin`.
- **Strict-Transport-Security (HSTS)**: Ensures all connections run over HTTPS.

## Logging & Monitoring

- Uses `pino` for structured JSON logging.
- Sensitive information (such as tokens or passwords) is never logged.
- Failed authentication attempts log the IP and provider for anomaly detection.
