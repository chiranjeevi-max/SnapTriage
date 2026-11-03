/**
 * @module auth/user-repository
 *
 * Data access layer for user and access-token records.
 *
 * These functions are called during the PAT sign-in flow to find or create
 * the user a token belongs to and to persist the token. All queries go
 * through `typedDb`.
 */
import { and, eq, isNull, type InferSelectModel } from "drizzle-orm";
import { runTransaction, typedDb } from "@/lib/db/query";
import { accessTokens, accounts, users } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";

/** A stored user record. */
type User = InferSelectModel<typeof users>;

/** A user as PAT sign-in creates one. */
interface NewUser {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
}

/** A Personal Access Token to store, with the provider account it belongs to. */
interface AccessTokenInput {
  userId: string;
  provider: string;
  providerAccountId: string;
  token: string;
  label: string;
}

/**
 * Finds a user by their email address.
 * @param email - The email to search for.
 * @returns The user record, or `null` if not found.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  const results = await typedDb.select().from(users).where(eq(users.email, email));
  return results[0] ?? null;
}

/**
 * Finds the user holding a PAT for a provider account.
 * @param provider - Git provider name.
 * @param providerAccountId - The account as stored with the token (`<instance>/<id>`).
 * @returns The user's ID, or `null` if no PAT is stored for the account.
 */
export async function findUserIdByAccessToken(
  provider: string,
  providerAccountId: string
): Promise<string | null> {
  const [row] = await typedDb
    .select({ userId: accessTokens.userId })
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.provider, provider),
        eq(accessTokens.providerAccountId, providerAccountId)
      )
    );
  return row?.userId ?? null;
}

/**
 * Finds the user an OAuth sign-in linked to a provider account.
 * @param provider - Git provider name.
 * @param providerAccountId - The provider's id for the account, as OAuth stores it.
 * @returns The user's ID, or `null` if no OAuth link exists for the account.
 */
export async function findUserIdByOAuthAccount(
  provider: string,
  providerAccountId: string
): Promise<string | null> {
  const [row] = await typedDb
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.provider, provider), eq(accounts.providerAccountId, providerAccountId)));
  return row?.userId ?? null;
}

/**
 * Whether a user has an OAuth link to a provider.
 * @param userId - The user's ID.
 * @param provider - Git provider name.
 */
export async function hasOAuthLink(userId: string, provider: string): Promise<boolean> {
  const links = await typedDb
    .select({ userId: accounts.userId })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, provider)))
    .limit(1);
  return links.length > 0;
}

/**
 * Returns the PAT a user stored for a provider before provider accounts were
 * recorded, still encrypted.
 *
 * @param userId - The user's ID.
 * @param provider - Git provider name.
 * @returns The encrypted token, or `null` if there is none.
 */
export async function findLegacyAccessToken(
  userId: string,
  provider: string
): Promise<string | null> {
  const [row] = await typedDb
    .select({ token: accessTokens.token })
    .from(accessTokens)
    .where(
      and(
        eq(accessTokens.userId, userId),
        eq(accessTokens.provider, provider),
        isNull(accessTokens.providerAccountId)
      )
    );
  return row?.token ?? null;
}

/**
 * Creates a user together with their first Personal Access Token.
 *
 * Both rows are written by one `runTransaction` call. On SQLite they commit
 * together, so a token that cannot be stored, including one that lost a race
 * for the same provider account, leaves no user behind; Neon writes them in
 * order.
 *
 * @param user - User fields including pre-generated ID.
 * @param pat - The token to store for the new user.
 */
export async function createUserWithAccessToken(
  user: NewUser,
  pat: Omit<AccessTokenInput, "userId">
) {
  await runTransaction([
    typedDb.insert(users).values(user),
    upsertAccessTokenQuery({ ...pat, userId: user.id }),
  ]);
}

/**
 * Updates an existing user's profile fields.
 * @param id - The user's ID.
 * @param data - Fields to update (name, image).
 * @returns The updated user, or `null` if no user has that ID.
 */
export async function updateUser(
  id: string,
  data: { name: string; image: string | null }
): Promise<User | null> {
  const [user] = await typedDb.update(users).set(data).where(eq(users.id, id)).returning();
  return user ?? null;
}

/**
 * Stores a Personal Access Token for a user+provider pair, replacing the
 * user's previous token for that provider.
 *
 * @param data - Token details: userId, provider, provider account, token
 *               string, and display label.
 */
export async function storeAccessToken(data: AccessTokenInput) {
  await upsertAccessTokenQuery(data);
}

/** Builds, without running, the encrypted token upsert keyed on user and provider. */
function upsertAccessTokenQuery(data: AccessTokenInput) {
  const encrypted = encrypt(data.token);

  return typedDb
    .insert(accessTokens)
    .values({
      userId: data.userId,
      provider: data.provider,
      providerAccountId: data.providerAccountId,
      token: encrypted,
      label: data.label,
    })
    .onConflictDoUpdate({
      target: [accessTokens.userId, accessTokens.provider],
      set: { providerAccountId: data.providerAccountId, token: encrypted, label: data.label },
    });
}
