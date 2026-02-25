import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { syncRepo, syncAllRepos } from "@/features/sync/sync-engine";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { repoId } = body as { repoId?: string };

  if (repoId) {
    const result = await syncRepo(repoId, session.user.id);
    return NextResponse.json(result);
  }

  const results = await syncAllRepos(session.user.id);
  return NextResponse.json(results);
}
