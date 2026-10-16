export const dynamic = "force-dynamic";

/**
 * @module /api/repos/[id]
 *
 * Operations on a single connected repository (update settings or disconnect).
 *
 * - **Endpoint:** `/api/repos/:id`
 * - **HTTP Methods:** PATCH, DELETE
 * - **Auth:** Required (session-based); repo must belong to the authenticated user
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { disconnectRepo, updateRepo } from "@/features/repos/repo-repository";
import { updateRepoSchema, parseBody } from "@/lib/validations";

/**
 * Disconnects (removes) a repository from the user's account.
 *
 * @param _req - Incoming request (unused)
 * @param params - Dynamic route params containing `id` (the repo's DB primary key)
 * @returns JSON `{ ok: true }` on success
 */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await disconnectRepo(id, session.user.id);
  return NextResponse.json({ ok: true });
}

/**
 * Updates settings for a connected repository (e.g. syncMode, syncEnabled).
 *
 * @param req - Request with JSON body containing `{ syncMode?, syncEnabled? }`
 * @param params - Dynamic route params containing `id` (the repo's DB primary key)
 * @returns JSON `{ ok: true }` on success, or an error with 400 status if no fields provided
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const rawBody = await req.json().catch(() => ({}));
  const parsed = parseBody(updateRepoSchema, rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.syncMode !== undefined) data.syncMode = parsed.data.syncMode;
  if (parsed.data.syncEnabled !== undefined) data.syncEnabled = parsed.data.syncEnabled;

  await updateRepo(id, session.user.id, data);
  return NextResponse.json({ ok: true });
}
