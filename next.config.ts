/** Next.js configuration -- enables standalone output for Docker deployment. */
import type { NextConfig } from "next";

let gitlabOrigin = "https://gitlab.com";
if (process.env.AUTH_GITLAB_URL) {
  try {
    gitlabOrigin = new URL(process.env.AUTH_GITLAB_URL).origin;
  } catch {
    gitlabOrigin = "https://gitlab.com";
  }
}

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: `default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://avatars.githubusercontent.com https://secure.gravatar.com https://*.gitlab.io ${gitlabOrigin}; font-src 'self'; connect-src 'self' https://api.github.com ${gitlabOrigin};`,
  },
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

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
