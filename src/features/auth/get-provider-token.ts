/**
 * @module auth/get-provider-token
 *
 * Resolves the best available API token for a user+provider pair.
 *
 * Token lookup order:
 * 1. OAuth `access_token` from the `accounts` table (set during OAuth sign-in)
 *    — skipped if the token has expired (checked via `expires_at`)
 * 2. Personal Access Token from the `accessTokens` table (set during PAT sign-in)
 *
 * Returns `null` if neither source has a valid token for the given provider.
 */
import { eq, and } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { accounts, accessTokens } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";

/**
 * Retrieves the user's access token for the specified provider.
 * Prefers OAuth tokens over PATs since OAuth tokens may have broader scopes,
 * but skips OAuth tokens that have expired.
 *
 * @param userId - The authenticated user's ID.
 * @param provider - The Git provider to fetch a token for.
 * @returns The token string, or `null` if none is available.
 */
export async function getProviderToken(
  userId: string,
  provider: "github" | "gitlab"
): Promise<string | null> {
  // Check OAuth account first
    const oauthAccounts = await typedDb
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)));

  if (oauthAccounts.length > 0 && oauthAccounts[0].access_token) {
    const account = oauthAccounts[0];

    // Check if the OAuth token has expired
    if (account.expires_at) {
      const expiresAtMs = account.expires_at * 1000; // expires_at is in seconds
      const now = Date.now();
      const bufferMs = 5 * 60 * 1000; // 5-minute buffer to avoid edge-case expiry

      if (now < expiresAtMs - bufferMs) {
        return account.access_token;
      }
      // Token expired — fall through to PAT
    } else {
      // No expiration set — token is long-lived (e.g., GitHub classic tokens)
      return account.access_token;
    }
  }

  // Fall back to PAT
    const pats = await typedDb
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.userId, userId), eq(accessTokens.provider, provider)));

  if (pats.length > 0) {
    return decrypt(pats[0].token);
  }

  return null;
}
