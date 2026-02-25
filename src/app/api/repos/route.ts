import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getConnectedRepos,
  connectRepo,
  findConnectedRepo,
} from "@/features/repos/repo-repository";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const repos = await getConnectedRepos(session.user.id);
  return NextResponse.json(repos);
}

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
