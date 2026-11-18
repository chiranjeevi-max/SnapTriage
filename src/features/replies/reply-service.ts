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
import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { issues, providerIdentities, replyDrafts, repos } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { providerLimits, type ProviderName } from "@/lib/provider-interface";
import { ProviderApiError } from "@/lib/provider-error";
import { REPLY_SEND_LEASE_MS } from "@/lib/provider-timing";
import { apiLogger } from "@/lib/logger";
import type { ProviderComment } from "@/lib/provider-interface";

/** A stored draft as the client sees it. */
export interface StoredDraft {
  id: string;
  body: string;
  version: number;
  sendAttemptedAt: string | null;
  /** Which attempt holds the claim, so a release can name it. */
  sendClaimId: string | null;
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
    sendClaimId: row.sendClaimId ?? null,
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
 * A claimed row is left in place. It is what stops a second tab from posting
 * the same reply, so deleting it would release that lock while the first send
 * is still unresolved. The caller is told the draft is still claimed rather
 * than being given a silent success.
 *
 * @returns `cleared`, `claimed` when an unresolved send owns the row, or
 *   `missing` when there was nothing to remove.
 */
export async function clearDraft(
  userId: string,
  issueId: string,
  expectedVersion: number | null = null
): Promise<"cleared" | "claimed" | "stale" | "missing"> {
  const existing = await findDraft(userId, issueId);
  if (!existing) return "missing";
  if (existing.sendAttemptedAt) return "claimed";

  // `0` means "this tab had no stored draft, so the stored one must still be
  // absent for this delete to be about the tab's own text". Without it, a tab
  // that never loaded a draft would delete one another tab has since written,
  // and the user would lose text that was never on their screen.
  if (expectedVersion === 0) return "stale";

  const removed = await typedDb
    .delete(replyDrafts)
    .where(
      and(
        eq(replyDrafts.issueId, issueId),
        eq(replyDrafts.userId, userId),
        // Re-checked in the predicate, not only above: a send can claim the row
        // between the read and this delete.
        isNull(replyDrafts.sendAttemptedAt),
        // A tab showing an older version is not looking at the draft it is about
        // to delete. Without this it could discard a newer one from another tab.
        expectedVersion === null ? undefined : eq(replyDrafts.version, expectedVersion)
      )
    )
    .returning({ id: replyDrafts.id });

  if (removed.length > 0) return "cleared";
  return (await findDraft(userId, issueId))?.sendAttemptedAt ? "claimed" : "stale";
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
 * @param expectedVersion - The draft version the composer was showing, or `null`
 *   to send without a draft. When supplied, a send whose draft has since moved
 *   on is refused: the user is looking at text that is no longer the stored one.
 * @returns The created comment, or a failure that says whether it is ambiguous.
 */
export async function sendReply(
  userId: string,
  target: ReplyTarget,
  body: string,
  expectedVersion: number | null = null
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
    return {
      ok: false,
      // A capability gap, not a transient one: nothing was sent and nothing can
      // be. Reported as 5xx it would read to the client as "maybe it posted",
      // which would latch the composer unconfirmed over a request never made.
      status: 422,
      error: "This provider does not support comments yet.",
    };
  }

  // Claim the attempt atomically. A read-then-write would leave a window in
  // which two tabs both observe "no attempt yet" and both post; the conditional
  // update closes it because only one statement can match an unclaimed row.
  const refused = await claimAttempt(userId, target.issueId, body, expectedVersion);
  if (refused === "stale") {
    return {
      ok: false,
      status: 409,
      error: "This draft changed in another tab. Reload it before sending.",
    };
  }
  if (refused === "unresolved") {
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

    // The comment is published, so the draft and its claim are both spent.
    // Removed directly rather than through `clearDraft`, which deliberately
    // refuses a claimed row because every other caller is a user action.
    await typedDb.delete(replyDrafts).where(
      and(
        eq(replyDrafts.issueId, target.issueId),
        eq(replyDrafts.userId, userId),
        // This attempt's row, not whatever draft exists now. A success that
        // arrives after the lease expired must not delete text another tab has
        // since written.
        eq(replyDrafts.sendClaimId, refused.claimId)
      )
    );
    apiLogger.info(
      { issueId: target.issueId, provider: target.provider, commentId: comment.id },
      "Reply published"
    );
    return { ok: true, comment, draftCleared: true };
  } catch (error) {
    // A rejection that carries a provider status is definitive: the provider
    // answered, and it did not accept the comment.
    if (error instanceof ProviderApiError && !error.isRetryable) {
      await clearAttempt(userId, target.issueId, refused.claimId);
      apiLogger.warn(
        { issueId: target.issueId, provider: target.provider, status: error.status },
        "Reply rejected by provider"
      );
      return {
        ok: false,
        // 422, not 502: this is a definitive answer, and the client treats every
        // 5xx as ambiguous because a gateway can drop the `unconfirmed` flag. A
        // rejection reported as 5xx would leave the draft unconfirmed forever and
        // withhold Send for nothing.
        status: 422,
        error: "The provider rejected this reply. Your draft has been kept.",
      };
    }

    // Anything else — a timeout, an abort, a 5xx — might have been accepted.
    // The attempt marker stays so the draft is not offered for sending again.
    //
    // The lease ends, though: this call is over, so there is no longer a second
    // publish in flight to protect against. Keeping it would make the claim
    // unreleasable for the whole lease window even though nothing is running.
    await endAttemptLease(userId, target.issueId, refused.claimId);
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
 * `expectedVersion` closes a gap the claim alone leaves open: a tab that has
 * been sitting on an old copy could otherwise post text another tab has since
 * replaced, and then delete that newer draft on success. Passing `null` opts out
 * for a composer that never stored a draft.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue being replied to.
 * @param body - The text being sent.
 * @param expectedVersion - The version the composer displayed, or `null`.
 * @returns Why the claim failed, or the identity it took when this caller owns
 *          the attempt. The identity is what a later release must match.
 */
async function claimAttempt(
  userId: string,
  issueId: string,
  body: string,
  expectedVersion: number | null
): Promise<"unresolved" | "stale" | { claimId: string }> {
  // A row is created only when the caller expects no stored draft: `null` (no
  // opinion) or `0` (asserts absence). A caller holding a real version expects
  // its row to exist, so inserting one here would be replacing a draft another tab
  // has already sent and deleted — and publishing it would post the reply twice.
  const mayCreate = expectedVersion === null || expectedVersion === 0;

  const created = mayCreate
    ? await typedDb
        .insert(replyDrafts)
        .values({ issueId, userId, body, sendAttemptedAt: null, updatedAt: new Date() })
        .onConflictDoNothing({ target: [replyDrafts.issueId, replyDrafts.userId] })
        .returning({ id: replyDrafts.id, version: replyDrafts.version })
    : [];

  const creator = created[0] ?? null;

  // `0` asserts no stored draft existed when this editor started. If no row was
  // created, another tab's draft was already there — publishing over it would post
  // text this tab never saw.
  if (expectedVersion === 0 && creator === null) return "stale";

  const claimId = crypto.randomUUID();
  // Stamped after the insert, not at the top of the function: the lease must
  // start when the claim is written, not before a write that may take time.
  const claimedAt = new Date();
  const claimed = await typedDb
    .update(replyDrafts)
    .set({
      sendAttemptedAt: claimedAt,
      sendClaimId: claimId,
      // A lease, not a flag: if this process dies mid-call the row must not stay
      // unreleasable forever. Past this instant the call is taken to have ended
      // however it ended, and the claim becomes an ordinary unresolved one. The
      // value is four request deadlines, so it covers this update plus a full
      // provider call even when the write is slow.
      sendInFlightUntil: new Date(claimedAt.getTime() + REPLY_SEND_LEASE_MS),
      body,
      updatedAt: claimedAt,
    })
    .where(
      and(
        eq(replyDrafts.issueId, issueId),
        eq(replyDrafts.userId, userId),
        isNull(replyDrafts.sendAttemptedAt),
        // Three cases, and they are not the same:
        //  - this call created the row: condition on that row and its version, so
        //    a save by another tab between the insert and here is detected rather
        //    than claimed;
        //  - `0` with no row created: another tab's draft appeared, which is
        //    exactly what `0` asserts cannot happen, so refuse;
        //  - a real version: the row must still carry it.
        creator !== null
          ? and(eq(replyDrafts.id, creator.id), eq(replyDrafts.version, creator.version))
          : expectedVersion === null
            ? undefined
            : eq(replyDrafts.version, expectedVersion)
      )
    )
    .returning({ id: replyDrafts.id });

  if (claimed.length > 0) return { claimId };

  // Two different reasons reach this point, and the user's next action differs:
  // an unresolved attempt means check the provider, a stale draft means reload.
  const current = await findDraft(userId, issueId);
  return current?.sendAttemptedAt ? "unresolved" : "stale";
}

/**
 * Release a send claim the user has checked and resolved.
 *
 * The only other paths that clear `sendAttemptedAt` are a confirmed success and
 * a definitive provider rejection. When the provider is unreachable both are
 * unavailable, so without this the user is locked out of the issue: every save,
 * send, and discard returns 409 under a message telling them to check the issue,
 * and checking it changes nothing.
 *
 * This is user-initiated on purpose. The app cannot tell whether the comment was
 * posted, so clearing the marker automatically would reintroduce the duplicate
 * it exists to prevent.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue being reconciled.
 * @returns Whether a claimed draft was released.
 */
export async function releaseSendClaim(
  userId: string,
  issueId: string,
  claimId?: string
): Promise<"released" | "in_flight" | "mismatch" | "missing"> {
  const now = new Date();

  const released = await typedDb
    .update(replyDrafts)
    .set({
      sendAttemptedAt: null,
      sendClaimId: null,
      sendInFlightUntil: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(replyDrafts.issueId, issueId),
        eq(replyDrafts.userId, userId),
        isNotNull(replyDrafts.sendAttemptedAt),
        // The attempt the user was looking at, and it is required. A caller that
        // cannot name the claim it is looking at cannot know the claim it would
        // free: passing `undefined` through as "match anything" let a tab with a
        // stale view release a newer send. Legacy rows with no id are matched
        // explicitly, so the absence of an id is a value rather than a wildcard.
        claimId === undefined
          ? isNull(replyDrafts.sendClaimId)
          : eq(replyDrafts.sendClaimId, claimId),
        // Refuse while the provider call may still be running. Releasing then
        // lets a second call start while the first can still publish, which is
        // the duplicate this whole marker exists to prevent.
        or(isNull(replyDrafts.sendInFlightUntil), lte(replyDrafts.sendInFlightUntil, now))
      )
    )
    .returning({ id: replyDrafts.id });

  if (released.length > 0) return "released";

  // Say why, because the caller's next action differs: waiting is right for an
  // active call, reloading is right for a superseded attempt.
  const current = await findDraft(userId, issueId);
  if (!current?.sendAttemptedAt) return "missing";

  // A caller with no identity cannot be matched, so it may only be told to
  // reload. This is the case where a publish succeeded but its response was
  // lost: the draft is gone, no claim exists, and the release should succeed —
  // but if a claim *does* exist, it belongs to a send this tab never saw.
  if (claimId === undefined) return "mismatch";
  if (current.sendClaimId !== claimId) return "mismatch";
  return "in_flight";
}

/**
 * Drop the in-flight lease without touching the claim.
 *
 * Marks the provider call as finished while leaving the attempt unresolved, so
 * the user may reconcile it. Called on every path that ends a call.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue being replied to.
 */
async function endAttemptLease(userId: string, issueId: string, claimId: string): Promise<void> {
  await typedDb
    .update(replyDrafts)
    .set({ sendInFlightUntil: null })
    .where(
      and(
        eq(replyDrafts.issueId, issueId),
        eq(replyDrafts.userId, userId),
        // Scoped to the attempt that set it. A call that outlived its lease can
        // finish after another send has claimed the row, and this write must not
        // tell every reader that the newer call has ended.
        eq(replyDrafts.sendClaimId, claimId)
      )
    );
}

/**
 * Clear the attempt marker after a definitive rejection.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue being replied to.
 */
async function clearAttempt(userId: string, issueId: string, claimId: string): Promise<void> {
  await typedDb
    .update(replyDrafts)
    .set({
      sendAttemptedAt: null,
      sendClaimId: null,
      sendInFlightUntil: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(replyDrafts.issueId, issueId),
        eq(replyDrafts.userId, userId),
        // Only this attempt's claim. Clearing whatever marker is present would
        // free a claim a newer send is holding, and a third send could then
        // overlap it — the duplicate this marker exists to prevent.
        eq(replyDrafts.sendClaimId, claimId)
      )
    );
}

/** The user's own login on a provider, as recorded the last time it was fetched. */
export interface ProviderIdentity {
  login: string;
  avatar: string | null;
}

/** How long a cached provider login is trusted before it is re-read. */
const IDENTITY_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Read the cached provider login, refreshing it when older than a day.
 *
 * The login lets the follow-up check tell a reporter's reply from the user's
 * own. It changes roughly never, so caching is right, but caching it forever is
 * not: reconnecting a different account would leave the old login in place and
 * every comment from the new account would read as somebody else's.
 *
 * A failed refresh keeps the cached value. Dropping it would make the check
 * treat the user's own comments as news, which is the false positive the
 * identity exists to prevent.
 *
 * @param userId - The authenticated user.
 * @param provider - The provider to identify against.
 * @returns The login, or `null` when it has never been resolved.
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
  const fresh = cached && Date.now() - cached.fetchedAt.getTime() < IDENTITY_TTL_MS;
  if (fresh) return { login: cached.login, avatar: cached.avatar };

  const token = await getProviderToken(userId, provider);
  if (!token) return cached ? { login: cached.login, avatar: cached.avatar } : null;

  const client = getProvider(provider);
  if (!client.getAuthenticatedUser) {
    return cached ? { login: cached.login, avatar: cached.avatar } : null;
  }

  const identity = await client.getAuthenticatedUser(token);
  if (!identity) return cached ? { login: cached.login, avatar: cached.avatar } : null;

  await typedDb
    .insert(providerIdentities)
    .values({ userId, provider, login: identity.login, avatar: identity.avatar })
    .onConflictDoUpdate({
      target: [providerIdentities.userId, providerIdentities.provider],
      set: { login: identity.login, avatar: identity.avatar, fetchedAt: new Date() },
    });

  return identity;
}
