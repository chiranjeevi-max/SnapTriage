/**
 * @module next.config
 *
 * Next.js configuration -- enables standalone output for Docker deployment.
 *
 * Security headers are applied to every response. The Content-Security-Policy
 * is *not* set here: a static header cannot carry a per-request nonce, and
 * Next.js emits the RSC payload as an inline script, so the policy is built
 * and attached by `src/proxy.ts` instead (see `src/lib/csp.ts`).
 *
 * Issue bodies are rendered by untrusted third-party authors via react-markdown
 * without `rehype-raw`, so CSP is the backstop against stored XSS.
 */
import type { NextConfig } from "next";

/** Security headers applied to every response. */
export function securityHeaders() {
  return [
    {
      key: "X-Frame-Options",
      value: "DENY",
    },
    {
      key: "X-Content-Type-Options",
      value: "nosniff",
    },
    {
      key: "Referrer-Policy",
      value: "strict-origin-when-cross-origin",
    },
    {
      key: "Strict-Transport-Security",
      value: "max-age=63072000; includeSubDomains; preload",
    },
  ];
}

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders(),
      },
    ];
  },
};

export default nextConfig;
