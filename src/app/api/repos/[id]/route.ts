import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { disconnectRepo, updateRepo } from "@/features/repos/repo-repository";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  await disconnectRepo(id, session.user.id);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await req.json();
  const { syncMode, syncEnabled } = body;

  const data: Record<string, unknown> = {};
  if (syncMode !== undefined) data.syncMode = syncMode;
  if (syncEnabled !== undefined) data.syncEnabled = syncEnabled;

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  await updateRepo(id, session.user.id, data);
  return NextResponse.json({ ok: true });
}
