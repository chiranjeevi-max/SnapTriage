export const dynamic = "force-dynamic";

/**
 * @module /api/saved-replies
 *
 * The user's personal reply templates.
 *
 * A template is prose, not a provider value, so it is scoped by user only and
 * can be offered on any issue. It is kept apart from the per-issue draft
 * because the lifetimes differ: a template is reused, a draft is discarded.
 *
 * - **Endpoint:** `/api/saved-replies`
 * - **HTTP Methods:** GET, POST
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { typedDb } from "@/lib/db/query";
import { savedReplies } from "@/lib/db/schema";
import { createSavedReplySchema, parseBody } from "@/lib/validations";

/** Maximum number of templates a user may keep. */
const SAVED_REPLY_LIMIT = 100;

/**
 * Lists the user's templates, most recently updated first.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await typedDb
    .select()
    .from(savedReplies)
    .where(eq(savedReplies.userId, session.user.id))
    .orderBy(desc(savedReplies.updatedAt));

  return NextResponse.json(
    rows.map((row) => ({
      id: row.id,
      name: row.name,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }))
  );
}

/**
 * Creates a template.
 *
 * @param req - Request with JSON body `{ name, body }`.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(createSavedReplySchema, rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const existing = await typedDb
    .select({ id: savedReplies.id })
    .from(savedReplies)
    .where(eq(savedReplies.userId, session.user.id));

  if (existing.length >= SAVED_REPLY_LIMIT) {
    return NextResponse.json(
      {
        error: `You already have ${SAVED_REPLY_LIMIT} saved replies, the maximum allowed. Delete one to save another.`,
      },
      { status: 409 }
    );
  }

  const inserted = await typedDb
    .insert(savedReplies)
    .values({
      userId: session.user.id,
      name: parsed.data.name,
      body: parsed.data.body,
    })
    .returning();

  const row = inserted[0];
  return NextResponse.json(
    {
      id: row.id,
      name: row.name,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
    { status: 201 }
  );
}
