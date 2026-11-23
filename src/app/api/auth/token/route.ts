export const dynamic = "force-dynamic";

/**
 * @module /api/auth/token
 *
 * Validates a Personal Access Token (PAT) against GitHub or GitLab.
 *
 * - **Endpoint:** `/api/auth/token`
 * - **HTTP Methods:** POST
 * - **Auth:** Public; used during PAT-based sign-in flow
 */
import { NextResponse } from "next/server";
import { validateToken, InvalidTokenError } from "@/features/auth/validate-token";
import { tokenValidationSchema, parseBody } from "@/lib/validations";
import { checkPersistentRateLimit } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-context";
import { apiLogger } from "@/lib/logger";

/**
 * Validates a provider PAT and returns the associated user info.
 *
 * @param req - Request with JSON body `{ token: string; provider: "github" | "gitlab" }`
 * @returns JSON `{ valid: true, user }` on success, or an error with 400/401/429/502 status
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
  } catch (error) {
    // `InvalidTokenError` means the provider rejected the credential itself, and
    // only that case may answer 401. Every other failure — a provider outage, or
    // a fault in the rate-limit store — used to be reported as "Invalid token"
    // too, which told the user their credential was bad when it might be fine and
    // left an operator with no trace of the real fault.
    if (error instanceof InvalidTokenError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    apiLogger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        ip: rateLimitKey(req, "pat:validate"),
      },
      "Token validation failed"
    );
    return NextResponse.json({ error: "Could not validate the token right now" }, { status: 502 });
  }
}
