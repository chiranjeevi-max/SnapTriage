export const dynamic = "force-dynamic";

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
import { connectRepoSchema, parseBody } from "@/lib/validations";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { getProvider } from "@/lib/providers";

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
 * The repository identity and its permission are both derived server-side: the
 * permission comes from the provider API, and the full name is built from the
 * owner/name pair the permission was resolved for. A client-supplied
 * `permission` or `fullName` cannot be used to self-grant access or to point
 * the record at a repository the user does not control.
 *
 * @param req - Request with JSON body `{ provider, owner, name }`
 * @returns JSON `{ id }` with 201 status on success, or an error with 400/403/404/409 status
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rawBody = await req.json().catch(() => null);
  const parsed = parseBody(connectRepoSchema, rawBody ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { provider, owner, name } = parsed.data;
  const fullName = `${owner}/${name}`;

  // A valid provider token is required before a repo can be connected.
  const token = await getProviderToken(session.user.id, provider);
  if (!token) {
    return NextResponse.json(
      { error: `No ${provider} account connected. Sign in with ${provider} first.` },
      { status: 403 }
    );
  }

  // Derive permission from the provider — never trust the client value.
  const providerImpl = getProvider(provider);
  const permission = await providerImpl.getRepoPermission(owner, name, token);
  if (permission === null) {
    return NextResponse.json(
      { error: `Repository not found or not accessible: ${fullName}` },
      { status: 404 }
    );
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
    permission,
  });

  return NextResponse.json({ id }, { status: 201 });
}
