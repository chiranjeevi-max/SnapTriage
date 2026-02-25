/**
 * @module /api/repos/[id]/collaborators
 *
 * Fetches collaborators from the provider (GitHub/GitLab) for a connected repository.
 *
 * - **Endpoint:** `/api/repos/:id/collaborators`
 * - **HTTP Methods:** GET
 * - **Auth:** Required (session-based); repo must belong to the authenticated user
 */
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/lib/db";
import { repos } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";

/**
 * Retrieves all collaborators for the given repo from its provider API.
 * Returns an empty array if the provider does not support collaborator fetching.
 *
 * @param _req - Incoming request (unused)
 * @param params - Dynamic route params containing `id` (the repo's DB primary key)
 * @returns JSON array of collaborator objects from the provider, or an error with 401/404 status
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const repoRows = await (db as any)
    .select()
    .from(repos)
    .where(and(eq(repos.id, id), eq(repos.userId, session.user.id)));

  if (repoRows.length === 0) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 });
  }

  const repo = repoRows[0];
  const token = await getProviderToken(session.user.id, repo.provider);
  if (!token) {
    return NextResponse.json({ error: "No token" }, { status: 401 });
  }

  const provider = getProvider(repo.provider);
  if (!provider.fetchCollaborators) {
    return NextResponse.json([]);
  }

  const collaborators = await provider.fetchCollaborators(repo.owner, repo.name, token);
  return NextResponse.json(collaborators);
}
