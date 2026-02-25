/**
 * @module /api/repos
 *
 * CRUD operations for the authenticated user's connected repositories.
 *
 * - **Endpoint:** `/api/repos`
 * - **HTTP Methods:** GET, POST
 * - **Auth:** Required (session-based)
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getConnectedRepos,
  connectRepo,
  findConnectedRepo,
} from "@/features/repos/repo-repository";

/**
 * Lists all repositories the current user has connected to SnapTriage.
 *
 * @returns JSON array of connected repo objects
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repos = await getConnectedRepos(session.user.id);
  return NextResponse.json(repos);
}

/**
 * Connects a new repository to the user's account.
 *
 * @param req - Request with JSON body `{ provider, owner, name, fullName, permission? }`
 * @returns JSON `{ id }` with 201 status on success, or an error with 400/409 status
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json();
  const { provider, owner, name, fullName, permission } = body;

  if (!provider || !owner || !name || !fullName) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  // Check if already connected
  const existing = await findConnectedRepo(session.user.id, provider, fullName);
  if (existing) {
    return NextResponse.json({ error: "Repo already connected" }, { status: 409 });
  }

  const id = await connectRepo({
    userId: session.user.id,
    provider,
    owner,
    name,
    fullName,
    permission: permission ?? "read",
  });

  return NextResponse.json({ id }, { status: 201 });
}
