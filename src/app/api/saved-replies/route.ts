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
import { count, desc, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { typedDb } from "@/lib/db/query";
import { savedReplies } from "@/lib/db/schema";
import { createSavedReplySchema, parseBody } from "@/lib/validations";

/** Maximum number of templates a user may keep. */
const SAVED_REPLY_LIMIT = 100;

/**
 * Count a user's templates.
 *
 * @param userId - The owning user.
 * @returns How many templates they have stored.
 */
async function countSavedReplies(userId: string): Promise<number> {
  const rows = await typedDb
    .select({ total: count() })
    .from(savedReplies)
    .where(eq(savedReplies.userId, userId));
  return rows[0]?.total ?? 0;
}

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

  // Insert, then count, then undo if that made one too many. A count before the
  // insert is what races: two requests can both read 99 and both insert. Counting
  // after this row exists means the loser sees its own write included, and the
  // delete keeps the stored set within the limit either way.
  const inserted = await typedDb
    .insert(savedReplies)
    .values({
      userId: session.user.id,
      name: parsed.data.name,
      body: parsed.data.body,
    })
    .returning();

  const row = inserted[0];

  if ((await countSavedReplies(session.user.id)) > SAVED_REPLY_LIMIT) {
    await typedDb.delete(savedReplies).where(eq(savedReplies.id, row.id));
    return NextResponse.json(
      {
        error: `You already have ${SAVED_REPLY_LIMIT} saved replies, the maximum allowed. Delete one to save another.`,
      },
      { status: 409 }
    );
  }
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
