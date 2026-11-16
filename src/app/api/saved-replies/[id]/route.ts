export const dynamic = "force-dynamic";

/**
 * @module /api/saved-replies/[id]
 *
 * Rename, rewrite, or remove one of the user's reply templates.
 *
 * Both writes carry `userId` in the predicate rather than checking ownership
 * first, so a guessed id cannot be turned into a cross-user write.
 *
 * - **Endpoint:** `/api/saved-replies/:id`
 * - **HTTP Methods:** PATCH, DELETE
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { typedDb } from "@/lib/db/query";
import { savedReplies } from "@/lib/db/schema";
import { updateSavedReplySchema, parseBody } from "@/lib/validations";

/**
 * Updates a template's name, its body, or both.
 *
 * @param req - Request with JSON body `{ name?, body? }`.
 * @param params - Dynamic route params containing `id`.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(updateSavedReplySchema, rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const updated = await typedDb
    .update(savedReplies)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(and(eq(savedReplies.id, id), eq(savedReplies.userId, session.user.id)))
    .returning();

  const row = updated[0];
  if (!row) {
    return NextResponse.json({ error: "Saved reply not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    name: row.name,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  });
}

/**
 * Deletes a template.
 *
 * @param _req - Incoming request (unused).
 * @param params - Dynamic route params containing `id`.
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const removed = await typedDb
    .delete(savedReplies)
    .where(and(eq(savedReplies.id, id), eq(savedReplies.userId, session.user.id)))
    .returning({ id: savedReplies.id });

  if (removed.length === 0) {
    return NextResponse.json({ error: "Saved reply not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
