import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { pushBatchChanges } from "@/features/sync/sync-engine";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await pushBatchChanges(session.user.id);
  return NextResponse.json(result);
}
