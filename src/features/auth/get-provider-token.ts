/**
 * @module auth/get-provider-token
 *
 * Resolves the best available API token for a user+provider pair.
 *
 * Token lookup order:
 * 1. OAuth `access_token` from the `accounts` table (set during OAuth sign-in)
 *    — skipped if the token has expired (checked via `expires_at`) or cannot be
 *      decrypted with any known key
 * 2. Personal Access Token from the `accessTokens` table (set during PAT sign-in)
 *
 * Returns `null` if neither source yields a usable token for the given provider.
 */
import { eq, and } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { accounts, accessTokens } from "@/lib/db/schema";
import { decrypt, TokenDecryptionError } from "@/lib/crypto";
import { authLogger } from "@/lib/logger";

/** Refresh window applied to OAuth token expiry, to avoid acting on one about to lapse. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000;

/**
 * Reports whether a stored OAuth token is still inside its validity window.
 *
 * A missing `expires_at` means the credential is long-lived (for example a
 * classic personal access token), which is treated as usable.
 */
function isWithinExpiry(expiresAtSeconds: number | null): boolean {
  if (!expiresAtSeconds) return true;
  return Date.now() < expiresAtSeconds * 1000 - EXPIRY_BUFFER_MS;
}

/**
 * Decrypts a stored credential, reporting an unusable value as `null`.
 *
 * A value that fails authentication is indistinguishable from a corrupt one at
 * this layer, so it is logged and treated as "no credential available" — the
 * user is prompted to re-authenticate instead of hitting an unhandled error on
 * a request they initiated. Errors that are *not* decryption failures propagate:
 * those indicate a real fault that should stay visible.
 */
function readStoredToken(
  stored: string,
  context: { userId: string; provider: string }
): string | null {
  try {
    return decrypt(stored);
  } catch (error) {
    if (!(error instanceof TokenDecryptionError)) throw error;

    authLogger.warn(
      { userId: context.userId, provider: context.provider },
      "Stored provider token could not be decrypted; re-authentication required"
    );
    return null;
  }
}

/**
 * Retrieves the user's access token for the specified provider.
 * Prefers OAuth tokens over PATs since OAuth tokens may have broader scopes,
 * but skips OAuth tokens that are expired or undecryptable.
 *
 * @param userId - The authenticated user's ID.
 * @param provider - The Git provider to fetch a token for.
 * @returns The token string, or `null` if none is available.
 */
export async function getProviderToken(
  userId: string,
  provider: "github" | "gitlab"
): Promise<string | null> {
  const context = { userId, provider };

  const oauthAccounts = await typedDb
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)));

  // A user may have linked more than one account for the same provider. Any
  // of them can carry a usable token, so the first one that works wins.
  for (const account of oauthAccounts) {
    if (!account.access_token || !isWithinExpiry(account.expires_at)) continue;

    const oauthToken = readStoredToken(account.access_token, context);
    // An unusable OAuth token falls through to the next account rather than
    // short-circuiting, matching how an expired one is treated.
    if (oauthToken) return oauthToken;
  }

  const pats = await typedDb
    .select()
    .from(accessTokens)
    .where(and(eq(accessTokens.userId, userId), eq(accessTokens.provider, provider)));

  const pat = pats[0];
  return pat ? readStoredToken(pat.token, context) : null;
}
