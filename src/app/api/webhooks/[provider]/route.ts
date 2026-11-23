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
import { eq, and, gt, sql } from "drizzle-orm";
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
import { apiLogger } from "@/lib/logger";

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

/**
 * Repositories handled per subscriber page.
 *
 * One delivery fans out to every user tracking the repository, so this bounds
 * the work one statement or one burst of parallel syncs holds. It is a page
 * size, not a cap: a repository with more subscribers is read page by page so
 * nobody is left unsynced.
 */
const SUBSCRIBER_PAGE_SIZE = 50;

/**
 * Pages one delivery may sync before it stops and asks to be retried.
 *
 * 20 pages is 1,000 subscribers in one request, well past any realistic
 * repository and still bounded. A delivery that hits this is forgotten and
 * answered 503, so the provider's retry re-reads from the start rather than the
 * work being lost mid-flight.
 */
const MAX_SUBSCRIBER_PAGES = 20;

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
  const limit = pLimit(3);
  const firstPage = await reposForDelivery(provider, fullName, null);

  if (firstPage.length === 0) {
    await forgetDelivery(provider, deliveryId);
    return NextResponse.json({ ok: true, ignored: true });
  }

  // Subscribers are synced page by page, up to a hard page budget.
  //
  // The budget matters as much as the paging. A repository popular enough to fill
  // many pages would otherwise run thousands of syncs inside one request; if the
  // worker is killed part-way the delivery record stays, so the provider's retry
  // is treated as a replay and the rest is never reached. Stopping at the budget
  // and reporting the remainder keeps one request bounded and leaves the delivery
  // retryable.
  //
  // Every read is guarded. A database error on a later page would otherwise throw
  // out of the handler after earlier pages had already synced, and the delivery
  // record would stay behind, stranding the subscribers on the unread pages.
  let synced = 0;
  let failedCount = 0;
  let page = firstPage;
  let exhausted = false;

  for (let pages = 0; ; pages++) {
    if (pages >= MAX_SUBSCRIBER_PAGES) {
      exhausted = true;
      break;
    }

    const results = await Promise.all(
      page.map((repo) => limit(() => syncRepo(repo.id, repo.userId)))
    );
    const failures = results.filter((result) => result?.status === "failed");
    synced += results.length - failures.length;
    failedCount += failures.length;

    if (page.length < SUBSCRIBER_PAGE_SIZE) break;

    try {
      page = await reposForDelivery(provider, fullName, page[page.length - 1].id);
    } catch (error) {
      apiLogger.error(
        { provider, fullName, error: error instanceof Error ? error.message : String(error) },
        "Webhook subscriber page could not be read"
      );
      // The remaining subscribers are unknown, so the delivery did not finish.
      // Forgetting it is what lets the provider retry; without that the retry is
      // treated as a replay and the rest is never synced.
      await forgetDelivery(provider, deliveryId);
      return NextResponse.json({ ok: false, error: "Could not read subscribers" }, { status: 500 });
    }

    if (page.length === 0) break;
  }

  if (exhausted) {
    apiLogger.warn(
      { provider, fullName, synced, pageBudget: MAX_SUBSCRIBER_PAGES },
      "Webhook delivery hit its page budget; remaining subscribers left for a retry"
    );
    await forgetDelivery(provider, deliveryId);
    return NextResponse.json(
      { ok: false, error: "Subscriber budget reached", synced },
      { status: 503 }
    );
  }

  if (failedCount > 0) {
    // The delivery did not complete its work, so it must stay retryable.
    await forgetDelivery(provider, deliveryId);
    return NextResponse.json({ ok: false, error: "Sync failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, synced });
}

/**
 * One page of the repositories tracking a given repository upstream, ordered by
 * id so a cursor can resume past the last row seen.
 *
 * @param provider - The provider the delivery came from.
 * @param fullName - The provider's spelling of the repository.
 * @param after - The last id already handled, or `null` for the first page.
 * @returns Up to {@link SUBSCRIBER_PAGE_SIZE} repositories.
 */
async function reposForDelivery(provider: string, fullName: string, after: string | null) {
  const matching = and(
    eq(repos.provider, provider),
    eq(sql`lower(${repos.fullName})`, fullName.toLowerCase()),
    eq(repos.syncEnabled, true)
  );

  return typedDb
    .select()
    .from(repos)
    .where(after === null ? matching : and(matching, gt(repos.id, after)))
    .orderBy(repos.id)
    .limit(SUBSCRIBER_PAGE_SIZE);
}
