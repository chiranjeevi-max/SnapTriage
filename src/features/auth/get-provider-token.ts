import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { accounts, accessTokens } from "@/lib/db/schema";

/**
 * Get the user's access token for a given provider.
 * Checks OAuth accounts first, then falls back to PATs.
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
