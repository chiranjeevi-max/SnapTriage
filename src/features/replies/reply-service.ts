/**
 * @module replies/reply-service
 *
 * Draft persistence and the one path that publishes a comment.
 *
 * Two invariants shape this module.
 *
 * The first is that a draft is the user's work. It is saved server-side and
 * updated conditionally on its version, so a reload, a second tab, or a crash
 * cannot lose it and a stale writer cannot silently overwrite a newer edit.
 *
 * The second is that publishing is irreversible. There is no idempotency key on
 * either provider's comment endpoint, so a request that times out is
 * indistinguishable from one that never arrived. Rather than retry — which
 * could post the same reply twice to a public thread — the attempt is claimed
 * with a conditional update before the provider is called, and the draft stays
 * unconfirmed until the outcome is known. Send is withheld in that state; the
 * user reconciles.
 *
 * That is weaker than a distributed transaction. Recovering an unconfirmed send
 * is a manual act: the user checks the issue before trying again.
 */
import { and, eq, isNull } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { issues, providerIdentities, replyDrafts, repos } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { providerLimits, type ProviderName } from "@/lib/provider-interface";
import { ProviderApiError } from "@/lib/provider-error";
import { apiLogger } from "@/lib/logger";
import type { ProviderComment } from "@/lib/provider-interface";

/** A stored draft as the client sees it. */
export interface StoredDraft {
  id: string;
  body: string;
  version: number;
  sendAttemptedAt: string | null;
  updatedAt: string;
}

/** The result of attempting to publish a reply. */
export type SendReplyResult =
  | { ok: true; comment: ProviderComment; draftCleared: true }
  | {
      ok: false;
      status: number;
      error: string;
      /**
       * Set when the provider may have accepted the comment. The caller must not
       * offer a retry in this case; the draft stays unconfirmed until the user
       * checks the issue.
       */
      unconfirmed?: true;
    };

/** An issue joined to the repository it belongs to, scoped to one user. */
export interface ReplyTarget {
  issueId: string;
  repoId: string;
  provider: ProviderName;
  owner: string;
  name: string;
  number: number;
  url: string;
}

/**
 * Load one of the user's issues with the coordinates a provider call needs.
 *
 * The join through `repos.userId` is the ownership check, so a caller cannot
 * reach an issue by guessing an id.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue's database id.
 * @returns The target, or `null` when the issue is not the user's.
 */
export async function loadReplyTarget(
  userId: string,
  issueId: string
): Promise<ReplyTarget | null> {
  const rows = await typedDb
    .select({ issue: issues, repo: repos })
    .from(issues)
    .innerJoin(repos, eq(repos.id, issues.repoId))
    .where(and(eq(issues.id, issueId), eq(repos.userId, userId)));

  const row = rows[0];
  if (!row) return null;

  return {
    issueId: row.issue.id,
    repoId: row.repo.id,
    provider: row.repo.provider as ProviderName,
    owner: row.repo.owner,
    name: row.repo.name,
    number: row.issue.number,
    url: row.issue.url,
  };
}

/**
 * Read the user's draft for one issue.
 *
 * @returns The draft, or `null` when none has been written yet.
 */
export async function findDraft(userId: string, issueId: string): Promise<StoredDraft | null> {
  const rows = await typedDb
    .select()
    .from(replyDrafts)
    .where(and(eq(replyDrafts.issueId, issueId), eq(replyDrafts.userId, userId)));

  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id,
    body: row.body,
    version: row.version,
    sendAttemptedAt: row.sendAttemptedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Why a draft save was refused. */
export type DraftSaveOutcome =
  { ok: true; draft: StoredDraft } | { ok: false; status: 409; error: string };

/**
 * Create or replace the user's draft for one issue.
 *
 * The write is conditional on `expectedVersion`, and creating a row the caller
 * believes does not exist is arbitrated by the unique key rather than by a
 * read-then-write, so two tabs cannot both create one.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue the draft belongs to.
 * @param body - The new draft text.
 * @param expectedVersion - The version the editor last read; `0` means "none yet".
 * @returns The saved draft, or a conflict the client resolves by reloading.
 */
export async function saveDraft(
  userId: string,
  issueId: string,
  body: string,
  expectedVersion: number
): Promise<DraftSaveOutcome> {
  if (expectedVersion === 0) {
    const existing = await findDraft(userId, issueId);
    if (existing) {
      return {
        ok: false,
        status: 409,
        error: "This draft was created in another tab. Reload it before saving.",
      };
    }

    await typedDb
      .insert(replyDrafts)
      .values({ issueId, userId, body, version: 1, updatedAt: new Date() })
      .onConflictDoNothing({ target: [replyDrafts.issueId, replyDrafts.userId] });

    const created = await findDraft(userId, issueId);
    if (!created) {
      return { ok: false, status: 409, error: "Another tab created this draft first." };
    }

    // A concurrent creator won the race; the caller's text is not silently kept.
    if (created.body !== body) {
      return {
        ok: false,
        status: 409,
        error: "This draft was created in another tab. Reload it before saving.",
      };
    }
    return { ok: true, draft: created };
  }

  const updated = await typedDb
    .update(replyDrafts)
    .set({ body, version: expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(replyDrafts.issueId, issueId),
        eq(replyDrafts.userId, userId),
        eq(replyDrafts.version, expectedVersion),
        // A claimed row belongs to the send that claimed it. Writing it would
        // replace the text that is actually on its way to the provider, and the
        // send deletes the row on success — so the accepted edit would vanish
        // with no trace of why.
        isNull(replyDrafts.sendAttemptedAt)
      )
    )
    .returning({ id: replyDrafts.id });

  if (updated.length === 0) {
    const current = await findDraft(userId, issueId);
    if (current?.sendAttemptedAt) {
      return {
        ok: false,
        status: 409,
        error:
          "A send from this draft is still unconfirmed. Check the issue before saving over it.",
      };
    }
    return {
      ok: false,
      status: 409,
      error: "This draft changed somewhere else. Reload it before saving.",
    };
  }

  const saved = await findDraft(userId, issueId);
  if (!saved) {
    return { ok: false, status: 409, error: "Draft could not be read back after saving." };
  }
  return { ok: true, draft: saved };
}

/**
 * Clear the user's draft for one issue.
 *
 * @returns Whether a row was removed.
 */
export async function clearDraft(userId: string, issueId: string): Promise<boolean> {
  const removed = await typedDb
    .delete(replyDrafts)
    .where(and(eq(replyDrafts.issueId, issueId), eq(replyDrafts.userId, userId)))
    .returning({ id: replyDrafts.id });
  return removed.length > 0;
}

/**
 * Publish a reply to an issue.
 *
 * The provider call happens between recording the attempt and recording its
 * outcome, never inside a database transaction: holding a transaction open over
 * a network call would block other writers for as long as the provider takes,
 * and a transaction cannot undo an HTTP request anyway.
 *
 * On a confirmed provider rejection the attempt marker is cleared, so the draft
 * returns to an editable state with its text intact. On anything ambiguous —
 * a timeout, an abort, a 5xx that may have been accepted — the marker stays and
 * the caller is told the outcome is unknown.
 *
 * @param userId - The authenticated user.
 * @param target - The issue and its provider coordinates.
 * @param body - The comment text.
 * @returns The created comment, or a failure that says whether it is ambiguous.
 */
export async function sendReply(
  userId: string,
  target: ReplyTarget,
  body: string
): Promise<SendReplyResult> {
  const limits = providerLimits[target.provider];
  if (body.length > limits.comment) {
    return {
      ok: false,
      status: 400,
      error: `Comments are limited to ${limits.comment} characters on ${target.provider}.`,
    };
  }

  const token = await getProviderToken(userId, target.provider);
  if (!token) {
    return { ok: false, status: 403, error: "No provider token available" };
  }

  const provider = getProvider(target.provider);
  if (!provider.createComment) {
    return { ok: false, status: 501, error: "This provider does not support comments yet." };
  }

  // Claim the attempt atomically. A read-then-write would leave a window in
  // which two tabs both observe "no attempt yet" and both post; the conditional
  // update closes it because only one statement can match an unclaimed row.
  const claimed = await claimAttempt(userId, target.issueId, body);
  if (!claimed) {
    return {
      ok: false,
      status: 409,
      error:
        "A previous send was not confirmed. Check the issue before sending again, so the reply is not posted twice.",
      unconfirmed: true,
    };
  }

  try {
    const comment = await provider.createComment(
      target.owner,
      target.name,
      target.number,
      token,
      body
    );

    await clearDraft(userId, target.issueId);
    apiLogger.info(
      { issueId: target.issueId, provider: target.provider, commentId: comment.id },
      "Reply published"
    );
    return { ok: true, comment, draftCleared: true };
  } catch (error) {
    // A rejection that carries a provider status is definitive: the provider
    // answered, and it did not accept the comment.
    if (error instanceof ProviderApiError && !error.isRetryable) {
      await clearAttempt(userId, target.issueId);
      apiLogger.warn(
        { issueId: target.issueId, provider: target.provider, status: error.status },
        "Reply rejected by provider"
      );
      return {
        ok: false,
        status: 502,
        error: "The provider rejected this reply. Your draft has been kept.",
      };
    }

    // Anything else — a timeout, an abort, a 5xx — might have been accepted.
    // The attempt marker stays so the draft is not offered for sending again.
    apiLogger.warn(
      { issueId: target.issueId, provider: target.provider, error: String(error) },
      "Reply outcome unknown; draft left unconfirmed"
    );
    return {
      ok: false,
      status: 409,
      error:
        "We could not confirm this reply was posted. Check the issue before sending again; your draft has been kept.",
      unconfirmed: true,
    };
  }
}

/**
 * Claim the right to send, atomically, storing the text being sent.
 *
 * Two statements, in this order, and both are needed:
 *
 * 1. `INSERT ... ON CONFLICT DO NOTHING` creates the draft row when the composer
 *    never saved one. A competing insert is a no-op rather than an error. The
 *    body is stored here, not left blank: if the send turns out to be
 *    unconfirmed, the message telling the user their draft was kept has to be
 *    true, and if the provider rejects it the text must still be editable.
 * 2. `UPDATE ... WHERE sendAttemptedAt IS NULL` takes the claim. Only one
 *    caller can match an unclaimed row, so a second tab or device is refused
 *    instead of posting a duplicate.
 *
 * The update also writes `body`, which is what makes the stored draft equal to
 * what was actually submitted even when autosave had not caught up.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue being replied to.
 * @param body - The text being sent.
 * @returns `true` when this caller owns the attempt.
 */
async function claimAttempt(userId: string, issueId: string, body: string): Promise<boolean> {
  const now = new Date();

  await typedDb
    .insert(replyDrafts)
    .values({ issueId, userId, body, sendAttemptedAt: null, updatedAt: now })
    .onConflictDoNothing({ target: [replyDrafts.issueId, replyDrafts.userId] });

  const claimed = await typedDb
    .update(replyDrafts)
    .set({ sendAttemptedAt: now, body, updatedAt: now })
    .where(
      and(
        eq(replyDrafts.issueId, issueId),
        eq(replyDrafts.userId, userId),
        isNull(replyDrafts.sendAttemptedAt)
      )
    )
    .returning({ id: replyDrafts.id });

  return claimed.length > 0;
}

/**
 * Clear the attempt marker after a definitive rejection.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue being replied to.
 */
async function clearAttempt(userId: string, issueId: string): Promise<void> {
  await typedDb
    .update(replyDrafts)
    .set({ sendAttemptedAt: null, updatedAt: new Date() })
    .where(and(eq(replyDrafts.issueId, issueId), eq(replyDrafts.userId, userId)));
}

/** The user's own login on a provider, as recorded the last time it was fetched. */
export interface ProviderIdentity {
  login: string;
  avatar: string | null;
}

/**
 * Read the cached provider login, refreshing it when missing or stale.
 *
 * This identity is what lets the follow-up check tell a reporter's reply from
 * the user's own. It is cached because it changes roughly never, and refreshed
 * lazily so a rotation of the token's account is picked up on the next read
 * rather than requiring a sign-out.
 *
 * @param userId - The authenticated user.
 * @param provider - The provider to identify against.
 * @returns The login, or `null` when it cannot be resolved right now.
 */
export async function resolveIdentity(
  userId: string,
  provider: ProviderName
): Promise<ProviderIdentity | null> {
  const rows = await typedDb
    .select()
    .from(providerIdentities)
    .where(and(eq(providerIdentities.userId, userId), eq(providerIdentities.provider, provider)));

  const cached = rows[0];
  if (cached) return { login: cached.login, avatar: cached.avatar };

  const token = await getProviderToken(userId, provider);
  if (!token) return null;

  const client = getProvider(provider);
  if (!client.getAuthenticatedUser) return null;

  const identity = await client.getAuthenticatedUser(token);
  if (!identity) return null;

  await typedDb
    .insert(providerIdentities)
    .values({ userId, provider, login: identity.login, avatar: identity.avatar })
    .onConflictDoUpdate({
      target: [providerIdentities.userId, providerIdentities.provider],
      set: { login: identity.login, avatar: identity.avatar, fetchedAt: new Date() },
    });

  return identity;
}
