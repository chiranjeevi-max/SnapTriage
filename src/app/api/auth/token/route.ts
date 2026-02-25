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
import { validateToken, type TokenProvider } from "@/features/auth/validate-token";

/**
 * Validates a provider PAT and returns the associated user info.
 *
 * @param req - Request with JSON body `{ token: string; provider: "github" | "gitlab" }`
 * @returns JSON `{ valid: true, user }` on success, or an error with 400/401 status
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, provider } = body as { token: string; provider: TokenProvider };

    if (!token || !provider) {
      return NextResponse.json({ error: "Token and provider are required" }, { status: 400 });
    }

    if (provider !== "github" && provider !== "gitlab") {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const user = await validateToken(token, provider);
    return NextResponse.json({ valid: true, user });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
