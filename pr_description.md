🔒 Fix IP spoofing vulnerability in rate limiter

🎯 **What:** Fixed an IP spoofing vulnerability in the NextAuth `authorize` credentials provider rate limiter.

⚠️ **Risk:** The previous implementation used the raw `x-forwarded-for` string as the client IP without checking for multiple IPs or verifying trusted proxy headers. An attacker could bypass rate limits by sending a forged or variable comma-separated `X-Forwarded-For` header, preventing the rate limit counter from aggregating correctly.

🛡️ **Solution:** Updated the IP extraction logic to safely resolve the client IP:
1. Checked for `x-real-ip` first, which is reliably set by common reverse proxies (e.g., Vercel, Nginx) and overwrites client-provided values.
2. Fell back to extracting the first valid IP from a comma-separated `x-forwarded-for` string (dropping appended/spoofed downstream proxy IPs safely in standard proxy setups) rather than trusting the whole raw string.
3. Used the `"unknown"` fallback.
