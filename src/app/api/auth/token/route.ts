import { NextResponse } from "next/server";
import { validateToken, type TokenProvider } from "@/features/auth/validate-token";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { token, provider } = body as { token: string; provider: TokenProvider };

    if (!token || !provider) {
      return NextResponse.json({ error: "Token and provider are required" }, { status: 400 });
    }

    if (provider !== "github" && provider !== "gitlab") {
      return NextResponse.json({ error: "Invalid provider" }, { status: 400 });
    }

    const user = await validateToken(token, provider);
    return NextResponse.json({ valid: true, user });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }
}
