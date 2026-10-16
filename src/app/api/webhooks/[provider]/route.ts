export const dynamic = "force-dynamic";

/**
 * @module /api/webhooks/[provider]
 *
 * Receives webhook deliveries from GitHub/GitLab and triggers a repository
 * sync for the matching connected repos.
 *
 * Authentication uses a shared `WEBHOOK_SECRET` environment variable passed as
 * `?secret=` in the configured endpoint URL. Repository identity is derived
 * from the delivery payload, then matched against the connected repos.
 */
import { NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { typedDb } from "@/lib/db/query";
import { repos } from "@/lib/db/schema";
import { syncRepo } from "@/features/sync/sync-engine";

const providers = new Set(["github", "gitlab"]);

function safeSecretEqual(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function repositoryFullName(provider: string, body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  if (provider === "github") {
    const repository = record.repository as Record<string, unknown> | undefined;
    return typeof repository?.full_name === "string" ? repository.full_name : null;
  }
  const project = record.project as Record<string, unknown> | undefined;
  return typeof project?.path_with_namespace === "string" ? project.path_with_namespace : null;
}

export async function POST(req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!providers.has(provider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const expectedSecret = process.env.WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  const url = new URL(req.url);
  if (!safeSecretEqual(url.searchParams.get("secret"), expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fullName = repositoryFullName(provider, body);
  if (!fullName) {
    // Some deliveries (e.g. ping/test) are valid but carry no repository.
    return NextResponse.json({ ok: true, ignored: true });
  }

  const connectedRepos = await typedDb
    .select()
    .from(repos)
    .where(and(eq(repos.provider, provider), eq(repos.fullName, fullName)));

  if (connectedRepos.length === 0) {
    return NextResponse.json({ ok: true, ignored: true });
  }

  const { default: pLimit } = await import("p-limit");
  const limit = pLimit(3);
  const results = await Promise.all(
    connectedRepos.map((repo) => limit(() => syncRepo(repo.id, repo.userId)))
  );

  return NextResponse.json({ ok: true, synced: results });
}
