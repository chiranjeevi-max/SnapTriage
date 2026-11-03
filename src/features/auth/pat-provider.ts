/**
 * @module auth/pat-provider
 *
 * Defines the NextAuth Credentials provider for Personal Access Tokens.
 * This provider intercepts the sign-in request, enforces rate limits, validates
 * the token against the respective provider (GitHub/GitLab), and signs in the
 * user that owns that provider account, creating one on its first sign-in.
 */
import type { User } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  InvalidTokenError,
  validateToken,
  type TokenProvider,
  type ValidatedUser,
} from "@/features/auth/validate-token";
import {
  createUserWithAccessToken,
  findLegacyAccessToken,
  findUserByEmail,
  findUserIdByAccessToken,
  findUserIdByOAuthAccount,
  hasOAuthLink,
  storeAccessToken,
  updateUser,
} from "@/features/auth/user-repository";
import { decrypt, TokenDecryptionError } from "@/lib/crypto";
import { authLogger } from "@/lib/logger";
import { checkPersistentRateLimit } from "@/lib/rate-limit";
import { clientIp, rateLimitKey } from "@/lib/request-context";

/**
 * The instance each provider's OAuth sign-in uses. `auth.config.ts` gives the
 * OAuth providers no base URL, so OAuth links only ever name accounts here.
 */
const OAUTH_INSTANCES: Record<TokenProvider, string> = {
  github: "github.com",
  gitlab: "gitlab.com",
};

/** How a PAT's account is stored: ids repeat across GitLab instances, so it names the instance. */
function accountKey(account: ValidatedUser): string {
  return `${account.instance}/${account.id}`;
}

/**
 * Finds the user a validated PAT belongs to, or `null` on its first sign-in.
 *
 * Identity is the provider account, never the email address: providers do not
 * all verify the addresses they report, which is why Auth.js will not link
 * OAuth accounts on one either. A PAT already stored for the account comes
 * first, then one stored before accounts were recorded, then an OAuth link, so
 * PAT sign-in keeps reaching the user it reached before.
 */
async function findPatOwner(
  provider: TokenProvider,
  account: ValidatedUser,
  ip: string | null
): Promise<string | null> {
  const holder = await findUserIdByAccessToken(provider, accountKey(account));
  if (holder) return holder;

  // OAuth ids come from the OAuth instance; on any other they name someone else.
  const linked =
    account.instance === OAUTH_INSTANCES[provider]
      ? await findUserIdByOAuthAccount(provider, account.id)
      : null;
  return (await claimLegacyPat(provider, account, linked, ip)) ?? linked;
}

/**
 * Finds the owner of a PAT stored before provider accounts were recorded.
 *
 * The email address only nominates a candidate. An OAuth link from the same
 * account to the candidate proves the claim; otherwise the candidate's stored
 * token must still resolve to the same account, and no OAuth link of theirs may
 * name another one.
 */
async function claimLegacyPat(
  provider: TokenProvider,
  account: ValidatedUser,
  linked: string | null,
  ip: string | null
): Promise<string | null> {
  if (!account.email) return null;
  const candidate = await findUserByEmail(account.email);
  if (!candidate) return null;
  const stored = await findLegacyAccessToken(candidate.id, provider);
  if (stored === null) return null;
  if (candidate.id === linked) return candidate.id;

  // At the OAuth instance the candidate's own OAuth link names another account,
  // so the stored token can only have come from the old email match.
  const contradicted =
    account.instance === OAUTH_INSTANCES[provider] && (await hasOAuthLink(candidate.id, provider));

  if (!contradicted) {
    try {
      const owner = await validateToken(decrypt(stored), provider);
      if (owner.id === account.id) {
        authLogger.info(
          { ip: ip ?? "unattributed", provider, userId: candidate.id },
          "Claimed a legacy PAT for its provider account"
        );
        return candidate.id;
      }
    } catch (error) {
      // An unreadable or rejected token proves nothing about the account. Any
      // other failure means the check could not run, and refusing this sign-in
      // beats splitting the user in two.
      if (!(error instanceof TokenDecryptionError || error instanceof InvalidTokenError)) {
        throw error;
      }
    }
  }

  authLogger.warn({ ip: ip ?? "unattributed", provider }, "Could not verify a legacy PAT owner");
  return null;
}

/**
 * Signs a user in with a Personal Access Token.
 *
 * @param credentials - The submitted `token` and `provider` fields.
 * @param request - The sign-in request; its client address keys the rate limit.
 * @returns The signed-in user, or `null` when the token is not accepted.
 * @throws {Error} When the caller is over the sign-in rate limit.
 */
export async function authorizePat(
  credentials: Partial<Record<"token" | "provider", unknown>>,
  request: Request
): Promise<User | null> {
  const provider = credentials?.provider as TokenProvider | undefined;
  const ip = clientIp(request);

  // Scoped separately from the /api/auth/token validation step it follows, so
  // the two halves of one sign-in do not spend the same allowance.
  if (await checkPersistentRateLimit(rateLimitKey(request, "pat:signin"), 5)) {
    authLogger.warn(
      { ip: ip ?? "unattributed", provider: provider ?? "unknown" },
      "Rate limit exceeded for PAT authentication"
    );
    throw new Error("Too Many Requests. Please try again later.");
  }

  if (
    !credentials?.token ||
    typeof credentials.token !== "string" ||
    credentials.token.length > 255 ||
    !credentials.token.trim()
  ) {
    return null;
  }

  const token = credentials.token.trim();

  if (provider !== "github" && provider !== "gitlab") {
    return null;
  }

  try {
    const validatedUser = await validateToken(token, provider);
    const pat = {
      provider,
      providerAccountId: accountKey(validatedUser),
      token,
      label: `${provider}-pat`,
    };
    const userId = await findPatOwner(provider, validatedUser, ip);

    if (userId) {
      const user = await updateUser(userId, {
        name: validatedUser.name,
        image: validatedUser.image,
      });
      await storeAccessToken({ userId, ...pat });
      return {
        id: userId,
        name: validatedUser.name,
        email: user?.email ?? null,
        image: validatedUser.image,
      };
    }

    // A new user starts without an address. It decides nothing here, and Auth.js
    // refuses any OAuth sign-in whose address another user already holds.
    const user = {
      id: crypto.randomUUID(),
      name: validatedUser.name,
      email: null,
      image: validatedUser.image,
    };
    await createUserWithAccessToken(user, pat);
    authLogger.info(
      { ip: ip ?? "unattributed", provider, userId: user.id },
      "Created a user for a new PAT account"
    );
    return user;
  } catch (error) {
    // The class only: a message can carry the token (as an invalid header value)
    // or, on Neon, every bound query parameter.
    authLogger.error(
      {
        ip: ip ?? "unattributed",
        provider,
        error: error instanceof Error ? error.name : "unknown",
      },
      "Failed PAT Auth"
    );
    return null;
  }
}

export const patProvider = Credentials({
  id: "credentials",
  name: "Personal Access Token",
  credentials: {
    token: { label: "Token", type: "password" },
    provider: { label: "Provider", type: "text" },
  },
  authorize: authorizePat,
});
