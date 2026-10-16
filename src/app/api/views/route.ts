export const dynamic = "force-dynamic";

/**
 * @module /api/views
 *
 * Lists and creates the signed-in user's saved inbox views.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { typedDb } from "@/lib/db/query";
import { savedViews } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { parseBody } from "@/lib/validations";
import { z } from "zod";

const createViewSchema = z.object({
  name: z.string().trim().min(1).max(80),
  filter: z.enum(["all", "open", "dismissed", "snoozed", "urgent"]),
});

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const views = await typedDb
    .select()
    .from(savedViews)
    .where(eq(savedViews.userId, session.user.id));
  return NextResponse.json(views);
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.json();
  const parsed = parseBody(createViewSchema, rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { name, filter } = parsed.data;
  await typedDb.insert(savedViews).values({
    userId: session.user.id,
    name,
    filter,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
