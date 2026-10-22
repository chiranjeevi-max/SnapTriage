/**
 * @module tests/unit/lib/csp.test.ts
 *
 * Unit tests for the Content-Security-Policy built by `src/lib/csp.ts`.
 *
 * Security contract (OWASP A05):
 * - `script-src` must NOT contain `'unsafe-eval'` or `'unsafe-inline'` in
 *   production. These disable CSP as an XSS control.
 * - The policy must carry the per-request nonce: Next.js emits the RSC
 *   payload as an inline script, so a strict `script-src` without a matching
 *   nonce blocks the app's own scripts and the page never hydrates.
 * - The app renders untrusted third-party issue bodies, so CSP is the backstop
 *   against stored XSS.
 */
import { describe, it, expect } from "vitest";
import { buildCsp } from "@/lib/csp";

/** Extracts a single directive from a CSP string. */
function directive(csp: string, name: string): string {
  const found = csp
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));

  expect(found).toBeDefined();
  return found as string;
}

describe("buildCsp", () => {
  /**
   * @target buildCsp
   * @scenario Production (isDev = false)
   * @expectedOutput script-src carries the nonce but no unsafe-eval or
   *                 unsafe-inline
   */
  it("should not allow unsafe-eval or unsafe-inline in script-src in production", () => {
    const csp = buildCsp("test-nonce", false);
    const scriptDirective = directive(csp, "script-src");

    expect(scriptDirective).not.toContain("unsafe-eval");
    expect(scriptDirective).not.toContain("unsafe-inline");
    expect(scriptDirective).toContain("'self'");
  });

  /**
   * @target buildCsp
   * @scenario Production (isDev = false)
   * @expectedOutput script-src carries the per-request nonce, which is what
   *                 lets a strict policy coexist with Next.js' inline scripts
   */
  it("should include the request nonce in script-src", () => {
    const csp = buildCsp("abc123nonce", false);

    expect(directive(csp, "script-src")).toContain("'nonce-abc123nonce'");
  });

  /**
   * @target buildCsp
   * @scenario Development (isDev = true)
   * @expectedOutput script-src allows unsafe-eval for Next.js Fast Refresh
   */
  it("should allow unsafe-eval in script-src in development", () => {
    const csp = buildCsp("test-nonce", true);
    const scriptDirective = directive(csp, "script-src");

    expect(scriptDirective).toContain("unsafe-eval");
    expect(scriptDirective).toContain("'nonce-test-nonce'");
  });

  /**
   * @target buildCsp
   * @scenario Production (isDev = false)
   * @expectedOutput Defense-in-depth directives are present: frame-ancestors,
   *                 base-uri, form-action, object-src
   */
  it("should include defense-in-depth directives in production", () => {
    const csp = buildCsp("test-nonce", false);

    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  /**
   * @target buildCsp
   * @scenario Production (isDev = false)
   * @expectedOutput style-src keeps 'unsafe-inline'. A nonce cannot authorise
   *                 inline style attributes, and the app sets them.
   */
  it("should keep inline styles allowed", () => {
    const csp = buildCsp("test-nonce", false);

    expect(directive(csp, "style-src")).toContain("'unsafe-inline'");
  });
});
