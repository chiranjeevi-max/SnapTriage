/**
 * @module lib/csp
 *
 * Builds the Content-Security-Policy sent with HTML responses.
 *
 * The policy is applied per request by `src/proxy.ts`, which mints a fresh
 * nonce for every response. The nonce is not optional: Next.js emits the
 * React Server Component payload and its runtime as inline `<script>` tags, so
 * a `script-src` without `'unsafe-inline'` blocks them unless the response
 * carries a nonce the browser can match. Serving the policy from `next.config`
 * alone cannot work. A static header has no per-request nonce to attach.
 *
 * This module is imported by the proxy and therefore must stay edge-safe: no
 * Node.js built-ins, no database access, no secrets.
 */

/** Fallback GitLab origin used when no self-hosted instance is configured. */
const DEFAULT_GITLAB_ORIGIN = "https://gitlab.com";

/**
 * Resolves the origin of the configured GitLab instance.
 *
 * Only the origin is used, so a self-hosted instance on a sub-path still
 * produces a valid `img-src`/`connect-src` source.
 */
function gitlabOrigin(): string {
  const configured = process.env.AUTH_GITLAB_URL;
  if (!configured) return DEFAULT_GITLAB_ORIGIN;

  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_GITLAB_ORIGIN;
  }
}

/**
 * Builds the `script-src` directive.
 *
 * `'strict-dynamic'` makes browsers that support it ignore the `'self'`
 * allowance and trust only scripts carrying the nonce (plus scripts those
 * load). That is what makes a strict policy possible at all in the App Router.
 *
 * `'unsafe-eval'` is required in development only: React uses `eval` to
 * reconstruct component stacks for the dev overlay.
 */
function scriptSource(nonce: string, isDev: boolean): string {
  const sources = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`];
  if (isDev) sources.push("'unsafe-eval'");
  return sources.join(" ");
}

/**
 * Builds the Content-Security-Policy header value.
 *
 * `style-src` keeps `'unsafe-inline'`: a nonce cannot authorise inline style
 * *attributes*, and the app sets them (virtualised list heights, label
 * colours). Styles are not an execution context, so the risk they carry is
 * far below that of scripts.
 *
 * @param nonce - Per-request nonce minted by the proxy.
 * @param isDev - Whether the app runs in development.
 * @returns A CSP string safe to send as a response header.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  const gitlab = gitlabOrigin();

  return [
    `default-src 'self'`,
    `script-src ${scriptSource(nonce, isDev)}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://avatars.githubusercontent.com https://secure.gravatar.com https://*.gitlab.io ${gitlab}`,
    `font-src 'self'`,
    `connect-src 'self' https://api.github.com ${gitlab}`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
  ].join("; ");
}
