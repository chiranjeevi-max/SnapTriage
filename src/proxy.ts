/**
 * @module middleware
 *
 * Next.js middleware entry point. Protects authenticated routes (/inbox,
 * /settings, /repos) by redirecting unauthenticated users to /login, and
 * redirects already-authenticated users away from auth pages (/login) back
 * to /inbox.
 *
 * It also mints the per-request nonce that backs the Content-Security-Policy
 * for every page response. The policy is strict about scripts (Next.js emits
 * the RSC payload inline), so the nonce has to be attached to the request
 * headers before rendering, not only to the response.
 *
 * Auth.js v5 `auth()` wraps the handler so session data is available on
 * every matched request via `req.auth`.
 */
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";
import { buildCsp } from "@/lib/csp";

const { auth } = NextAuth(authConfig);

const protectedRoutes = ["/inbox", "/settings", "/repos"];
const authRoutes = ["/login"];

// Note: In-memory rate limiting is not used here because it is ineffective in
// Edge/Serverless environments. Use a Redis store (e.g. Upstash) or WAF for
// production rate limiting.

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthenticated = !!req.auth;

  // Redirect authenticated users away from auth pages
  if (isAuthenticated && authRoutes.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/inbox", req.nextUrl.origin));
  }

  // Redirect unauthenticated users to login
  if (!isAuthenticated && protectedRoutes.some((r) => pathname.startsWith(r))) {
    return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
  }

  // A fresh nonce per request keeps the policy strict: only scripts this
  // response vouches for may run.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce, process.env.NODE_ENV !== "production");

  // Next.js reads the policy from the *request* headers to find the nonce it
  // has to stamp onto the scripts it emits, and the browser enforces the copy
  // on the *response*.
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);

  return response;
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)", "/api/auth/callback/credentials"],
};
