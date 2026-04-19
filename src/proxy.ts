/**
 * @module proxy
 * Auth.js (NextAuth v5) middleware proxy. Protects authenticated routes
 * (/inbox, /settings, /repos) by redirecting unauthenticated users to /login,
 * and redirects already-authenticated users away from auth pages (/login)
 * back to /inbox. Exported as `proxy` and re-exported from `middleware.ts`.
 */
import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./auth.config";

const { auth } = NextAuth(authConfig);

const protectedRoutes = ["/inbox", "/settings", "/repos"];
const authRoutes = ["/login"];

// In-memory rate limiting map for basic protection against brute-force
const rateLimitMap = new Map<string, { count: number; timestamp: number }>();

export const proxy = auth((req) => {
  const { pathname } = req.nextUrl;
  
  // Rate limiting for the PAT credentials endpoint
  if (req.method === "POST" && pathname === "/api/auth/callback/credentials") {
    const ip = req.headers.get("x-forwarded-for") || "unknown";
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes window

    // Clean up old entries
    for (const [key, value] of rateLimitMap.entries()) {
      if (now - value.timestamp > windowMs) rateLimitMap.delete(key);
    }

    const record = rateLimitMap.get(ip) || { count: 0, timestamp: now };
    record.count++;

    if (record.count > 5) {
      return new NextResponse("Too Many Requests. Please try again later.", { status: 429 });
    }

    rateLimitMap.set(ip, record);
  }

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
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico).*)",
    "/api/auth/callback/credentials"
  ],
};
