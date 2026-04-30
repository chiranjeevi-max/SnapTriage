/**
 * @module auth/user-repository
 *
 * Data access layer for user and access-token records.
 *
 * These functions are called during the PAT sign-in flow to upsert users
 * and persist their tokens. All queries use Drizzle ORM with the shared `db`
 * client (cast to `any` to satisfy the SQLite/Neon union type).
 */
import { eq, and } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { users, accessTokens } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";

/**
 * Finds a user by their email address.
 * @param email - The email to search for.
 * @returns The user record, or `null` if not found.
 */
export async function findUserByEmail(email: string) {
  const results = await typedDb.select().from(users).where(eq(users.email, email));
  return results[0] ?? null;
}

/**
 * Creates a new user record in the database.
 * @param data - User fields including pre-generated ID.
 */
export async function createUser(data: {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
}) {
  await typedDb.insert(users).values(data);
}

/**
 * Updates an existing user's profile fields.
 * @param id - The user's ID.
 * @param data - Fields to update (name, image).
 */
export async function updateUser(id: string, data: { name: string; image: string | null }) {
  await typedDb.update(users).set(data).where(eq(users.id, id));
}

/**
 * Stores a Personal Access Token for a user+provider pair.
 * Upserts by removing any existing token for the same user+provider
 * combination before inserting the new one, preventing duplicate accumulation.
 *
 * @param data - Token details: userId, provider, token string, and display label.
 */
export async function storeAccessToken(data: {
  userId: string;
  provider: string;
  token: string;
  label: string;
}) {
  // Remove existing token for this user+provider pair (upsert)
  await typedDb
    .delete(accessTokens)
    .where(and(eq(accessTokens.userId, data.userId), eq(accessTokens.provider, data.provider)));

  await typedDb.insert(accessTokens).values({
    ...data,
    token: encrypt(data.token),
  });
}
