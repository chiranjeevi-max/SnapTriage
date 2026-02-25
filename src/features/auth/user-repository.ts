import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users, accessTokens } from "@/lib/db/schema";

export async function findUserByEmail(email: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const results = await (db as any).select().from(users).where(eq(users.email, email));
  return results[0] ?? null;
}

export async function createUser(data: {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).insert(users).values(data);
}

export async function updateUser(id: string, data: { name: string; image: string | null }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).update(users).set(data).where(eq(users.id, id));
}

export async function storeAccessToken(data: {
  userId: string;
  provider: string;
  token: string;
  label: string;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any).insert(accessTokens).values(data);
}
