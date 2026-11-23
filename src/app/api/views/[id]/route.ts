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
  const removed = await typedDb
    .delete(savedViews)
    .where(and(eq(savedViews.id, id), eq(savedViews.userId, session.user.id)))
    .returning({ id: savedViews.id });

  // `returning` is what distinguishes a delete from a no-op. Answering 200 for a
  // row that was never there tells the client its removal succeeded when the
  // view is still on screen and the next fetch will bring it back.
  if (removed.length === 0) {
    return NextResponse.json({ error: "View not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
