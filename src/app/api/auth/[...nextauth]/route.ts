/**
 * @module /api/auth/[...nextauth]
 *
 * Auth.js (NextAuth v5) catch-all route handler.
 * Delegates all authentication flow (sign-in, sign-out, callbacks, session)
 * to the Auth.js `handlers` exported from the central auth config.
 *
 * - **Endpoint:** `/api/auth/*`
 * - **HTTP Methods:** GET, POST (handled internally by Auth.js)
 * - **Auth:** Public — this IS the authentication entry-point
 */
import { handlers } from "@/auth";

/** Re-export the Auth.js GET and POST handlers for Next.js App Router. */
export const { GET, POST } = handlers;
