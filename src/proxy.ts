/**
 * @module middleware
 *
 * Next.js middleware entry point. Protects authenticated routes (/inbox,
 * /settings, /repos) by redirecting unauthenticated users to /login, and
 * redirects already-authenticated users away from auth pages (/login) back
 * to /inbox.
 *
 * Auth.js v5 `auth()` wraps the handler so session data is available on
 * every matched request via `req.auth`.
 */
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

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

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)", "/api/auth/callback/credentials"],
};
