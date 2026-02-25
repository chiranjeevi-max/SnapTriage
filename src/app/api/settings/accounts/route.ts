import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { accounts, accessTokens } from "@/lib/db/schema";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const oauthAccounts = await (db as any)
    .select({
      provider: accounts.provider,
      providerAccountId: accounts.providerAccountId,
      type: accounts.type,
    })
    .from(accounts)
    .where(eq(accounts.userId, session.user.id));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pats = await (db as any)
    .select({
      provider: accessTokens.provider,
      label: accessTokens.label,
    })
    .from(accessTokens)
    .where(eq(accessTokens.userId, session.user.id));

  const result = [
    ...oauthAccounts.map((a: { provider: string; providerAccountId: string; type: string }) => ({
      provider: a.provider,
      providerAccountId: a.providerAccountId,
      type: a.type,
    })),
    ...pats.map((p: { provider: string; label: string | null }) => ({
      provider: p.provider,
      providerAccountId: p.label ?? "token",
      type: "pat",
    })),
  ];

  return NextResponse.json(result);
}
