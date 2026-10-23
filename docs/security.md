# Security Overview

SnapTriage handles sensitive access tokens for GitHub and GitLab, as well as triage data.

## Authentication & Tokens

SnapTriage supports two ways to authenticate:
1. **OAuth Applications**: Standard OAuth 2.0 flow. Access tokens are provided by the identity provider.
2. **Personal Access Tokens (PAT)**: Used as a fallback or for strict environments.

### Token Encryption at Rest

Any access tokens (both OAuth and PAT) are encrypted at rest in the database using AES-256-GCM.
- The encryption key is derived using PBKDF2-HMAC-SHA256 from the `AUTH_SECRET` environment variable and the `AUTH_SALT` (a per-deployment salt, with a built-in default).
- Each encrypted payload includes a unique initialization vector (IV) and an authentication tag, so tampering is detected on decrypt.
- Records are stored as `v1:iv:tag:ciphertext`. Records written before the version tag existed (`iv:tag:ciphertext`) are still readable, and the pre-bump PBKDF2 work factor is still accepted for them.
- Decryption is fail-closed: a value that cannot be authenticated raises an error and the user is asked to re-authenticate. No plaintext is ever returned as a fallback.

## Rate Limiting

To protect the PAT login endpoint from brute-force attacks, SnapTriage rate-limits attempts by IP.
- Limits a single IP to 5 attempts (successful or failed) within a 15-minute window, per scope: `pat:validate` for the token endpoint and `pat:signin` for the sign-in callback, so one flow cannot exhaust the other's allowance.
- The client address comes from `x-forwarded-for`, and only the entries written by the app's own proxies are believed: `TRUSTED_PROXY_HOPS` states how many proxies append to that chain. With the default of `0` (the app exposed directly), no forwarding header is believable and all such traffic shares a single bucket.
- Counters live in the shared `rate_limit_bucket` table, so the limit holds across app instances. Expired rows are purged on each check, using the longest window in use, so a short-window scope can never reset a long-window one.
- If the database is unreachable, it falls back to an in-memory limiter with a capped map size, so protection stays on.

## Security Headers (Content Security Policy)

SnapTriage enforces strict HTTP response headers via `next.config.ts` and `src/proxy.ts`:
- **Content-Security-Policy**: Prevents execution of unauthorized scripts. Issue bodies can contain attacker-controlled HTML, so CSP is the main XSS defense. The policy is nonce-based: `src/proxy.ts` mints a fresh nonce per request and applies it to the request and the response, so `script-src` can stay at `'self' 'nonce-…' 'strict-dynamic'` without `'unsafe-inline'`. Next.js stamps the nonce onto the scripts it emits, which is why every page is rendered per request (`dynamic = "force-dynamic"` in the root layout).
- **X-Frame-Options: DENY**: Prevents clickjacking by disabling embedding in iframes.
- **X-Content-Type-Options: nosniff**: Prevents MIME-type confusion attacks.
- **Referrer-Policy**: Set to `strict-origin-when-cross-origin`.
- **Strict-Transport-Security (HSTS)**: Ensures all connections run over HTTPS.

## Webhooks

Webhook deliveries are authenticated with a shared secret carried in a header, never in the URL:
- GitHub sends `X-Hub-Signature-256: sha256=<HMAC-SHA256(secret, raw body)>`; the MAC is computed over the exact bytes received, so a body that is not valid UTF-8 still verifies.
- GitLab sends `X-Gitlab-Token: <secret>`.
- Both are compared in constant time, and a delivery is only processed once: its ID is recorded before the sync runs, and a failed sync drops the record again so the delivery stays retryable.
- Deliveries are rate-limited and bodies above 4 MB are refused unread.

## Logging & Monitoring

- Uses `pino` for structured JSON logging.
- Sensitive information (such as tokens or passwords) is never logged.
- Failed authentication attempts log the IP and provider for anomaly detection.

## Static Analysis (CodeQL)

SnapTriage runs [GitHub CodeQL](https://codeql.github.com/) on every pull request and push to `main`, plus a weekly scheduled scan. Results are surfaced in the repository's **Security → Code scanning alerts** tab. The workflow lives at `.github/workflows/codeql.yml` and query config at `.github/codeql/codeql-config.yml`.

To run CodeQL locally, install the `codeql` CLI and the JavaScript query pack, then:

```sh
codeql database create .codeql-db --language=javascript --source-root .
codeql database analyze .codeql-db codeql/javascript-queries:codeql-suites/javascript-security-and-quality.qls --format=sarif-latest --output=codeql.sarif
```

Severity `high`/`critical` findings from CodeQL or the existing gitleaks scan are expected to block merge where reported by the security workflow.
