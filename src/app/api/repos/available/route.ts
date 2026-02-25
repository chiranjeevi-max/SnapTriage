import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { fetchAvailableRepos } from "@/features/repos/fetch-available-repos";

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const provider = searchParams.get("provider") as "github" | "gitlab" | null;

  if (!provider || (provider !== "github" && provider !== "gitlab")) {
    return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
  }

  const token = await getProviderToken(session.user.id, provider);
  if (!token) {
    return NextResponse.json(
      { error: `No ${provider} account connected. Sign in with ${provider} first.` },
      { status: 403 }
    );
  }

  const repos = await fetchAvailableRepos(token, provider);
  return NextResponse.json(repos);
}
