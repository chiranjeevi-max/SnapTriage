export const dynamic = "force-dynamic";

/**
 * @module /api/auth/token
 *
 * Validates a Personal Access Token (PAT) against GitHub or GitLab.
 *
 * - **Endpoint:** `/api/auth/token`
 * - **HTTP Methods:** POST
 * - **Auth:** Public — used during PAT-based sign-in flow
 */
import { NextResponse } from "next/server";
import { validateToken } from "@/features/auth/validate-token";
import { tokenValidationSchema, parseBody } from "@/lib/validations";
import { checkPersistentRateLimit } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-context";

/**
 * Validates a provider PAT and returns the associated user info.
 *
 * @param req - Request with JSON body `{ token: string; provider: "github" | "gitlab" }`
 * @returns JSON `{ valid: true, user }` on success, or an error with 400/401 status
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    const parsed = parseBody(tokenValidationSchema, rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    // Scope is `validate` so this step does not share an allowance with the
    // credentials sign-in it feeds; otherwise one login would cost two attempts.
    if (await checkPersistentRateLimit(rateLimitKey(req, "pat:validate"), 5)) {
      return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
    }

    const user = await validateToken(parsed.data.token, parsed.data.provider);
    return NextResponse.json({ valid: true, user });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
