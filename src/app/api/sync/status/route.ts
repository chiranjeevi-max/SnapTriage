import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { repos } from "@/lib/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userRepos = await (db as any)
    .select({
      id: repos.id,
      fullName: repos.fullName,
      lastSyncedAt: repos.lastSyncedAt,
    })
    .from(repos)
    .where(eq(repos.userId, session.user.id));

  const statuses = userRepos.map(
    (r: { id: string; fullName: string; lastSyncedAt: Date | null }) => ({
      repoId: r.id,
      fullName: r.fullName,
      lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    })
  );

  return NextResponse.json(statuses);
}
