export const dynamic = "force-dynamic";

/**
 * @module /api/settings/accounts
 *
 * Returns the list of connected accounts (OAuth and PAT) for the authenticated user.
 * Used by the settings UI to show which providers are linked.
 *
 * - **Endpoint:** `/api/settings/accounts`
 * - **HTTP Methods:** GET
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { typedDb } from "@/lib/db/query";
import { accounts, accessTokens } from "@/lib/db/schema";

/**
 * Retrieves all connected accounts (OAuth + PAT) for the current user.
 * OAuth accounts come from the `accounts` table; PAT entries come from `accessTokens`.
 *
 * @returns JSON array of `{ provider, providerAccountId, type }` objects
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

    const oauthAccounts = await typedDb
    .select({
      provider: accounts.provider,
      providerAccountId: accounts.providerAccountId,
      type: accounts.type,
    })
    .from(accounts)
    .where(eq(accounts.userId, session.user.id));

    const pats = await typedDb
    .select({
      provider: accessTokens.provider,
      label: accessTokens.label,
    })
    .from(accessTokens)
    .where(eq(accessTokens.userId, session.user.id));

  const result = [
    ...oauthAccounts.map((a: { provider: string; providerAccountId: string; type: string }) => ({
      provider: a.provider,
      providerAccountId: a.providerAccountId,
      type: a.type,
    })),
    ...pats.map((p: { provider: string; label: string | null }) => ({
      provider: p.provider,
      providerAccountId: p.label ?? "token",
      type: "pat",
    })),
  ];

  return NextResponse.json(result);
}
