export const dynamic = "force-dynamic";

/**
 * @module /api/webhooks/[provider]
 *
 * Receives webhook deliveries from GitHub/GitLab and triggers a repository
 * sync for the matching connected repos.
 *
 * Authentication is header-borne and covers the request body:
 * - GitHub: `X-Hub-Signature-256: sha256=<HMAC-SHA256(secret, body)>`
 * - GitLab: `X-Gitlab-Token: <shared secret>`
 *
 * The secret is never transported in a URL query string, so it cannot leak
 * into proxy, CDN, or access logs. Deliveries are rate-limited per client IP
 * and deduplicated by delivery ID to make the endpoint idempotent and replay
 * resistant.
 */
import { NextResponse } from "next/server";
import { eq, and, sql } from "drizzle-orm";
import { timingSafeEqual, createHmac } from "node:crypto";
import pLimit from "p-limit";
import { typedDb } from "@/lib/db/query";
import { repos } from "@/lib/db/schema";
import { syncRepo } from "@/features/sync/sync-engine";
import {
  forgetDelivery,
  purgeExpiredDeliveries,
  recordDelivery,
} from "@/features/webhooks/delivery-store";
import { checkPersistentRateLimit } from "@/lib/rate-limit";
import { rateLimitKey } from "@/lib/request-context";

/** Providers this endpoint accepts deliveries for. */
const SUPPORTED_PROVIDERS: Record<string, true | undefined> = {
  github: true,
  gitlab: true,
};

/** Upper bound on a delivery body. Larger deliveries are rejected unread. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/**
 * Deliveries allowed per minute for one client.
 *
 * GitHub delivers from a small, shared pool of addresses, so a per-IP limit
 * has to tolerate a burst across every repository in the installation.
 */
const WEBHOOK_RATE_LIMIT = 120;
const WEBHOOK_RATE_WINDOW_MS = 60 * 1000;

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Verifies GitHub's `X-Hub-Signature-256` HMAC over the exact request body.
 * Returns false for anything that isn't a `sha256=` prefixed, matching MAC.
 */
function verifyGitHubSignature(rawBody: Buffer, signature: string | null, secret: string): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(signature, expected);
}

/** Outcome of reading the request body. */
type BodyRead = { ok: true; body: Buffer } | { ok: false; status: 400 | 413 };

/**
 * Reads the raw request body, refusing anything above the size limit.
 *
 * The bytes are kept as they arrived: the HMAC covers the exact body GitHub
 * signed, and re-encoding a decoded string would replace invalid byte
 * sequences with U+FFFD and break the comparison.
 */
async function readRawBody(req: Request): Promise<BodyRead> {
  const reader = req.body?.getReader();
  if (!reader) return { ok: false, status: 400 };

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413 };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400 };
  }

  return { ok: true, body: Buffer.concat(chunks) };
}

/** Extracts the repository full name from a provider delivery payload. */
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
  if (!SUPPORTED_PROVIDERS[provider]) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  const expectedSecret = process.env.WEBHOOK_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 503 });
  }

  // Rate limit before any crypto or upstream work, keyed on a non-spoofable IP.
  if (
    await checkPersistentRateLimit(
      rateLimitKey(req, "webhook"),
      WEBHOOK_RATE_LIMIT,
      WEBHOOK_RATE_WINDOW_MS
    )
  ) {
    return NextResponse.json({ error: "Too Many Requests" }, { status: 429 });
  }

  const bodyRead = await readRawBody(req);
  if (!bodyRead.ok) {
    return NextResponse.json(
      { error: bodyRead.status === 413 ? "Request body too large" : "Unable to read request body" },
      { status: bodyRead.status }
    );
  }
  const rawBody = bodyRead.body;

  const authorized =
    provider === "github"
      ? verifyGitHubSignature(rawBody, req.headers.get("x-hub-signature-256"), expectedSecret)
      : safeEqual(req.headers.get("x-gitlab-token") ?? "", expectedSecret);

  if (!authorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Replay protection: each provider delivery ID may be processed once. Both
  // providers always send one, so a delivery without it is not a delivery.
  const deliveryId =
    provider === "github"
      ? req.headers.get("x-github-delivery")
      : req.headers.get("x-gitlab-event-uuid");
  if (!deliveryId) {
    return NextResponse.json({ error: "Missing delivery ID" }, { status: 400 });
  }

  if (!(await recordDelivery(provider, deliveryId))) {
    return NextResponse.json({ ok: true, ignored: true, reason: "duplicate" });
  }

  // Reclaim rows that are past their retention window, so the table stays
  // bounded no matter how many deliveries arrive.
  await purgeExpiredDeliveries();

  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString("utf8"));
  } catch {
    await forgetDelivery(provider, deliveryId);
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const fullName = repositoryFullName(provider, body);
  if (!fullName) {
    // Some deliveries (e.g. ping/test) are valid but carry no repository.
    await forgetDelivery(provider, deliveryId);
    return NextResponse.json({ ok: true, ignored: true });
  }

  // The provider spells repository names in its own casing, while the name
  // the user typed when connecting the repo may differ, so the match is
  // case-insensitive. Repos the user switched off are left alone.
  const connectedRepos = await typedDb
    .select()
    .from(repos)
    .where(
      and(
        eq(repos.provider, provider),
        eq(sql`lower(${repos.fullName})`, fullName.toLowerCase()),
        eq(repos.syncEnabled, true)
      )
    )
    .limit(50);

  if (connectedRepos.length === 0) {
    await forgetDelivery(provider, deliveryId);
    return NextResponse.json({ ok: true, ignored: true });
  }

  const limit = pLimit(3);
  const results = await Promise.all(
    connectedRepos.map((repo) => limit(() => syncRepo(repo.id, repo.userId)))
  );

  const failed = results.filter((result) => result?.status === "failed");
  if (failed.length > 0) {
    // The delivery did not complete its work, so it must stay retryable.
    await forgetDelivery(provider, deliveryId);
    return NextResponse.json({ ok: false, error: "Sync failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, synced: results.length });
}
