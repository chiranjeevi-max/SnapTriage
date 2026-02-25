/**
 * @module auth/get-provider-token
 *
 * Resolves the best available API token for a user+provider pair.
 *
 * Token lookup order:
 * 1. OAuth `access_token` from the `accounts` table (set during OAuth sign-in)
 * 2. Personal Access Token from the `accessTokens` table (set during PAT sign-in)
 *
 * Returns `null` if neither source has a token for the given provider.
 */
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, accessTokens } from "@/lib/db/schema";

/**
 * Retrieves the user's access token for the specified provider.
 * Prefers OAuth tokens over PATs since OAuth tokens may have broader scopes.
 * @param userId - The authenticated user's ID.
 * @param provider - The Git provider to fetch a token for.
 * @returns The token string, or `null` if none is available.
 */
export async function getProviderToken(
  userId: string,
  provider: "github" | "gitlab"
): Promise<string | null> {
  // Check OAuth account first
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oauthAccounts = await (db as any)
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)));

  if (oauthAccounts.length > 0 && oauthAccounts[0].access_token) {
    return oauthAccounts[0].access_token;
  }

  // Fall back to PAT
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pats = await (db as any)
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.userId, userId), eq(accessTokens.provider, provider)));

  if (pats.length > 0) {
    return pats[0].token;
  }

  return null;
}
