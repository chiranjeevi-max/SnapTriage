export const dynamic = "force-dynamic";

/**
 * @module /api/views/[id]
 *
 * Deletes one of the signed-in user's saved views.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { typedDb } from "@/lib/db/query";
import { savedViews } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await typedDb
    .delete(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, session.user.id)));

  return NextResponse.json({ ok: true });
}
