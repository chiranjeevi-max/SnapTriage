import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { repos } from "@/lib/db/schema";

export async function getConnectedRepos(userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (db as any).select().from(repos).where(eq(repos.userId, userId));
}

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

export async function disconnectRepo(id: string, userId: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).delete(repos).where(and(eq(repos.id, id), eq(repos.userId, userId)));
}

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
