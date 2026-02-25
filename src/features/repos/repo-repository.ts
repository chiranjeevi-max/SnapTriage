/**
 * @module repos/repo-repository
 *
 * Data access layer for tracked repository CRUD operations.
 * All functions scope queries to a specific `userId` for multi-tenant safety.
 */
import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { repos } from "@/lib/db/schema";

/**
 * Lists all repositories connected by a given user.
 * @param userId - The user's ID.
 * @returns Array of repo records.
 */
export async function getConnectedRepos(userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).select().from(repos).where(eq(repos.userId, userId));
}

/**
 * Inserts a new tracked repo for a user.
 * @param data - Repo details (provider, owner, name, fullName, permission).
 * @returns The newly generated repo ID.
 */
export async function connectRepo(data: {
  userId: string;
  provider: "github" | "gitlab";
  owner: string;
  name: string;
  fullName: string;
  permission: string;
}) {
  const id = crypto.randomUUID();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).insert(repos).values({ id, ...data });
  return id;
}

/**
 * Removes a tracked repo, scoped to the owning user.
 * @param id - Repo record ID.
 * @param userId - The user's ID (ownership guard).
 */
export async function disconnectRepo(id: string, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).delete(repos).where(and(eq(repos.id, id), eq(repos.userId, userId)));
}

/**
 * Finds an existing tracked repo by user, provider, and full name.
 * Used to prevent duplicate connections.
 * @param userId - The user's ID.
 * @param provider - Git provider name.
 * @param fullName - "owner/repo" string.
 * @returns The repo record, or `null` if not found.
 */
export async function findConnectedRepo(userId: string, provider: string, fullName: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = await (db as any)
    .select()
    .from(repos)
    .where(
      and(eq(repos.userId, userId), eq(repos.provider, provider), eq(repos.fullName, fullName))
    );
  return results[0] ?? null;
}

/**
 * Updates repo settings (syncMode, syncEnabled), scoped to the owning user.
 * @param id - Repo record ID.
 * @param userId - The user's ID (ownership guard).
 * @param data - Fields to update.
 */
export async function updateRepo(
  id: string,
  userId: string,
  data: { syncMode?: string; syncEnabled?: boolean }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)
    .update(repos)
    .set(data)
    .where(and(eq(repos.id, id), eq(repos.userId, userId)));
}
