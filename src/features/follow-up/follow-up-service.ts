/**
 * @module follow-up/follow-up-service
 *
 * Arming, checking, and resolving follow-ups.
 *
 * A follow-up is explicit: the user says "tell me when something happens here",
 * and the row records what had already been read at that moment. Checking is
 * on demand — when the queue is opened — because the app has no scheduler and
 * pretending otherwise would mean showing stale results as live ones.
 *
 * The check is bounded: one page of comments per issue, a cap on how many
 * issues are examined per pass, and a cooldown so opening the inbox twice does
 * not hammer the provider. Anything not examined keeps its previous
 * `checkedAt`, which is what the UI shows to make freshness honest.
 */
import { and, eq, inArray, desc, isNull, lt, or } from "drizzle-orm";
import { typedDb } from "@/lib/db/query";
import { followUps, issues, repos } from "@/lib/db/schema";
import { getProvider } from "@/lib/providers";
import { getProviderToken } from "@/features/auth/get-provider-token";
import { providerLogger } from "@/lib/logger";
import type { ProviderComment, ProviderName } from "@/lib/provider-interface";
import {
  detectFollowUp,
  newestComment,
  type FollowUpReason,
  type FollowUpCheck,
} from "./detection";
import { resolveIdentity } from "@/features/replies/reply-service";

/** Maximum number of waiting issues examined in one check pass. */
const MAX_CHECKS_PER_PASS = 20;

/** How long a checked issue is left alone before it is re-checked. */
const RECHECK_COOLDOWN_MS = 60_000;

/**
 * How many comment pages one check may read.
 *
 * A bound is what keeps a long thread from turning a pass into an unbounded
 * crawl. Three pages covers ninety comments after the baseline, which is well
 * past the point where a real conversation is still waiting on a reply.
 */
const MAX_COMMENT_PAGES_PER_CHECK = 3;

/** One row of the follow-up queue as the UI consumes it. */
export interface FollowUpEntry {
  issueId: string;
  repoId: string;
  number: number;
  title: string;
  url: string;
  provider: string;
  fullName: string;
  state: "waiting" | "reviewed" | "stopped";
  reason: FollowUpReason | null;
  checkedAt: string | null;
  /** Why the issue is in the list now; `null` while nothing has happened yet. */
  due: boolean;
}

/** The result of a check pass. */
export interface FollowUpCheckSummary {
  checked: number;
  surfaced: number;
  /** Issues that could not be checked, so the UI can say some results are stale. */
  skipped: number;
}

/**
 * Arm a follow-up, or re-arm one that had been reviewed or stopped.
 *
 * The baseline is read from the provider *before* the row is written, so the
 * first check afterwards compares against what the user could actually see at
 * the moment they chose to wait. If the provider cannot be read, the follow-up
 * is still armed with a null baseline: that means "everything from now on is
 * new", which is conservative in the direction of not missing a reply.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue to wait on.
 * @returns The stored entry, or `null` when the issue is not the user's.
 */
export async function armFollowUp(userId: string, issueId: string): Promise<FollowUpEntry | null> {
  const target = await loadWaitingIssue(userId, issueId);
  if (!target) return null;

  const baseline = await readBaseline(userId, target);
  const now = new Date();

  const values = {
    state: "waiting" as const,
    lastSeenCommentId: baseline.commentId,
    lastSeenCommentAt: baseline.at,
    stateAtBaseline: target.state,
    // Arming reads the current state, so that is the first observation. Leaving
    // it null would make the next check fall back to the baseline and compare the
    // same two states, which is fine but loses the record of what was seen.
    lastObservedState: target.state,
    reviewedCommentId: null,
    reason: null,
    checkedAt: now,
    updatedAt: now,
  };

  await typedDb
    .insert(followUps)
    .values({ issueId, userId, ...values })
    .onConflictDoUpdate({
      target: [followUps.issueId, followUps.userId],
      set: values,
    });

  return toEntry(target, { ...values, state: "waiting", due: false });
}

/**
 * Mark a follow-up reviewed, which acknowledges the activity that raised it.
 *
 * Reviewing advances the baseline to the comment the user just looked at, so
 * the next pass compares against what they have actually seen. That is why the
 * check pass never moves the watermark itself: if it did, an unread resurface
 * would quietly retract on the next poll and the queue would lose the item.
 *
 * `reviewedCommentId` is stored as well, so a comment that ties with the
 * baseline instant cannot immediately re-raise the issue.
 *
 * A caller that does not know which comment raised the item — the follow-up
 * queue renders a reason, not the comment that produced it — passes `null`.
 * That is a genuine acknowledgement of "everything up to now", so the baseline
 * moves to the current instant instead of staying put. Leaving it unchanged
 * would make Review a no-op that lets the same comment raise again on the next
 * pass, which is the one bug a review control must not have.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue being reviewed.
 * @param reviewedCommentId - The comment that prompted the review, if known.
 * @param reviewedCommentAt - Its instant, used as the new baseline.
 * @returns Whether a followed issue was updated.
 */
export async function reviewFollowUp(
  userId: string,
  issueId: string,
  reviewedCommentId: string | null,
  reviewedCommentAt: Date | null
): Promise<boolean> {
  const now = new Date();
  const baselineAt = reviewedCommentAt ?? now;

  const updated = await typedDb
    .update(followUps)
    .set({
      state: "reviewed",
      reviewedCommentId,
      reason: null,
      lastSeenCommentId: reviewedCommentId,
      lastSeenCommentAt: baselineAt,
      checkedAt: now,
      updatedAt: now,
    })
    .where(and(eq(followUps.issueId, issueId), eq(followUps.userId, userId)))
    .returning({ id: followUps.id });

  return updated.length > 0;
}

/**
 * Stop tracking without calling it a review.
 *
 * Kept distinct from `review` because the two mean different things to the
 * user: "I have dealt with this" versus "I no longer care". Both are terminal
 * until re-armed, but only one is an acknowledgement.
 *
 * @param userId - The authenticated user.
 * @param issueId - The issue to stop tracking.
 */
export async function stopFollowUp(userId: string, issueId: string): Promise<boolean> {
  const updated = await typedDb
    .update(followUps)
    .set({ state: "stopped", reason: null, updatedAt: new Date() })
    .where(and(eq(followUps.issueId, issueId), eq(followUps.userId, userId)))
    .returning({ id: followUps.id });

  return updated.length > 0;
}

/**
 * List the user's followed issues, newest activity first.
 *
 * Includes `reviewed` and `stopped` rows so the pane can show the current state
 * of an issue the user explicitly acted on, rather than silently forgetting it.
 *
 * @param userId - The authenticated user.
 * @returns The entries, with `due` marked for those that have something new.
 */
export async function listFollowUps(userId: string): Promise<FollowUpEntry[]> {
  const rows = await typedDb
    .select({ followUp: followUps, issue: issues, repo: repos })
    .from(followUps)
    .innerJoin(issues, eq(issues.id, followUps.issueId))
    .innerJoin(repos, eq(repos.id, issues.repoId))
    .where(and(eq(followUps.userId, userId), eq(repos.userId, userId)))
    .orderBy(desc(followUps.updatedAt));

  return rows.map((row) =>
    toEntry(
      {
        issueId: row.issue.id,
        repoId: row.repo.id,
        number: row.issue.number,
        title: row.issue.title,
        url: row.issue.url,
        provider: row.repo.provider,
        fullName: row.repo.fullName,
        state: row.issue.state === "open" ? "open" : "closed",
      },
      {
        state: row.followUp.state as FollowUpEntry["state"],
        reason: row.followUp.reason as FollowUpReason | null,
        checkedAt: row.followUp.checkedAt,
        due: row.followUp.state === "waiting" && row.followUp.reason !== null,
      }
    )
  );
}

/**
 * Resolve the credentials and identity one pass needs, once per provider.
 *
 * Both are per-user and per-provider values, not per-issue ones, so reading
 * them inside the loop would repeat the same token decryption and the same
 * `GET /user` up to {@link MAX_CHECKS_PER_PASS} times. The cache is local to a
 * pass on purpose: a token can be rotated between passes, and a stale identity
 * is exactly what makes the "is this my comment" test wrong.
 */
type PassContext = Map<
  string,
  {
    token: string | null;
    identity: Promise<Awaited<ReturnType<typeof resolveIdentity>>> | null;
  }
>;

/**
 * Read the per-provider values for one pass, memoised on the provider name.
 *
 * Only settled values are kept. A rejected lookup is dropped so the next issue
 * on that provider tries again; memoising the rejection would turn one transient
 * failure into a whole-provider outage for the rest of the pass.
 *
 * @param userId - The authenticated user.
 * @param provider - The provider being checked.
 * @param cache - The pass-scoped cache.
 */
async function passContextFor(userId: string, provider: ProviderName, cache: PassContext) {
  const cached = cache.get(provider);
  if (cached) {
    return { token: cached.token, identity: await cached.identity };
  }

  const token = await getProviderToken(userId, provider);
  const identity = token ? await resolveIdentity(userId, provider) : null;
  cache.set(provider, { token, identity: Promise.resolve(identity) });

  return { token, identity };
}

/**
 * Run one bounded check pass over the user's waiting issues.
 *
 * Issues checked within the cooldown are skipped, which keeps a user who
 * refreshes the inbox repeatedly from turning that into repeated provider
 * traffic. A failure on one issue never aborts the pass: the row keeps its old
 * `checkedAt`, so the UI can show that particular result as stale.
 *
 * @param userId - The authenticated user.
 * @returns How many issues were examined and how many surfaced.
 */
export async function runFollowUpCheck(userId: string): Promise<FollowUpCheckSummary> {
  const cutoff = new Date(Date.now() - RECHECK_COOLDOWN_MS);

  // Two rules decide which rows this pass examines, and both belong in the query.
  //
  // The cooldown filters, because applying it after `.limit()` lets recently
  // checked rows consume the batch and starve the due ones.
  //
  // The ordering uses `attemptedAt`, not `checkedAt`. `checkedAt` only moves when
  // a check completes, so a row whose provider read keeps failing would stay the
  // oldest forever and be retried on every pass while healthy rows behind it
  // wait. Ordering by the last attempt rotates those rows to the back once they
  // have had their turn, and `checkedAt` keeps its meaning for the UI.
  // A row is due when neither its last attempt nor its last completed check is
  // inside the cooldown. Written as two disjunctions rather than a `coalesce`
  // so the predicate stays plain column comparisons, which both drivers index
  // and which any reader can check against the schema.
  // Due means "not attempted recently". `checkedAt` only decides the order for
  // rows that have never been attempted, so it does not appear here: including
  // it would permanently exclude a row whose attempts keep failing, which is the
  // starvation this column exists to prevent.
  const due = or(isNull(followUps.attemptedAt), lt(followUps.attemptedAt, cutoff));

  const waiting = await typedDb
    .select({ followUp: followUps, issue: issues, repo: repos })
    .from(followUps)
    .innerJoin(issues, eq(issues.id, followUps.issueId))
    .innerJoin(repos, eq(repos.id, issues.repoId))
    .where(and(eq(followUps.userId, userId), eq(followUps.state, "waiting"), due))
    // Oldest attempt first. NULL sorts below every timestamp on SQLite and
    // Postgres, so never-attempted rows lead. A failed row moves to the back on
    // its next pass because `attemptedAt` advanced.
    .orderBy(followUps.attemptedAt, followUps.checkedAt)
    .limit(MAX_CHECKS_PER_PASS);

  const cache: PassContext = new Map();
  let checked = 0;
  let surfaced = 0;
  let skipped = 0;

  for (const row of waiting) {
    const provider = getProvider(row.repo.provider);
    // Provenance is a provider capability, so it is answered once per provider
    // rather than once per issue.
    if (!provider.fetchComments) {
      // Record the turn even though nothing was read. Without it this row is
      // still due on the next pass, so twenty such rows occupy the batch forever
      // and a healthy row behind them is never reached.
      await markAttempted(row.followUp.id);
      skipped++;
      continue;
    }

    let context: Awaited<ReturnType<typeof passContextFor>>;
    try {
      context = await passContextFor(userId, row.repo.provider as ProviderName, cache);
    } catch (error) {
      // Reading the token or the login can fail on its own. That is one issue's
      // problem, not the pass's: letting it escape would abandon every follow-up
      // after it and report nothing examined.
      providerLogger.warn(
        { issueId: row.issue.id, error: String(error) },
        "Follow-up context could not be read; issue skipped"
      );
      // Same reason as above: a skipped row must not be re-selected ahead of the
      // ones that have not had a turn.
      await markAttempted(row.followUp.id);
      skipped++;
      continue;
    }

    const result = await checkOne(userId, row.followUp, row.issue, row.repo, context);
    if (!result) {
      skipped++;
      continue;
    }
    checked++;
    if (result.qualifies) surfaced++;
  }

  return { checked, surfaced, skipped };
}

/** One joined follow-up row as the check needs it. */
type FollowUpRow = typeof followUps.$inferSelect;
type IssueRow = typeof issues.$inferSelect;
type RepoRow = typeof repos.$inferSelect;

/**
 * Check one issue and persist the outcome.
 *
 * @returns The verdict, or `null` when the provider could not be read.
 */
async function checkOne(
  userId: string,
  followUp: FollowUpRow,
  issue: IssueRow,
  repo: RepoRow,
  context: { token: string | null; identity: { login: string } | null }
): Promise<FollowUpCheck | null> {
  const providerName = repo.provider as ProviderName;
  const provider = getProvider(providerName);
  if (!provider.fetchComments) return null;
  if (!context.token) return null;

  const token = context.token;
  const now = new Date();

  try {
    // Ask only for what changed since the baseline, then walk towards older
    // history while the cursor lasts. A single page is not enough: thirty of the
    // user's own comments after the baseline would fill it and hide the reply
    // that follows them. The walk is bounded so one long thread cannot turn a
    // pass into an unbounded crawl.
    const since = followUp.lastSeenCommentAt ?? undefined;
    const comments: ProviderComment[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < MAX_COMMENT_PAGES_PER_CHECK; page++) {
      const fetched = await provider.fetchComments(repo.owner, repo.name, issue.number, token, {
        since,
        limit: 30,
        cursor,
      });
      comments.push(...fetched.comments);
      cursor = fetched.olderCursor;
      if (!cursor) break;
    }

    // The state this check actually saw, persisted with the result so the next
    // check can compare against it. Written only on a completed read: a failed
    // fetch has observed nothing.
    const observedState = issue.state === "open" ? ("open" as const) : ("closed" as const);

    const identity = context.identity;
    const check = detectFollowUp(
      {
        lastSeenCommentId: followUp.lastSeenCommentId,
        lastSeenCommentAt: followUp.lastSeenCommentAt,
        stateAtBaseline: followUp.stateAtBaseline === "closed" ? "closed" : "open",
        lastObservedState:
          followUp.lastObservedState === "closed"
            ? "closed"
            : followUp.lastObservedState === "open"
              ? "open"
              : null,
        reviewedCommentId: followUp.reviewedCommentId,
      },
      comments,
      { selfLogin: identity?.login ?? null, state: issue.state === "open" ? "open" : "closed" }
    );

    if (check.qualifies) {
      // The baseline is deliberately NOT advanced here. A resurface is a claim
      // that the user has not dealt with this yet, and advancing the watermark
      // would retract that claim on the next pass while the item is still
      // unreviewed. `reviewFollowUp` moves the baseline instead, which is the
      // one moment the user has actually acknowledged the activity.
      await typedDb
        .update(followUps)
        .set({
          reason: check.reason,
          checkedAt: now,
          attemptedAt: now,
          lastObservedState: observedState,
          updatedAt: now,
        })
        .where(eq(followUps.id, followUp.id));
    } else {
      await typedDb
        .update(followUps)
        .set({
          checkedAt: now,
          attemptedAt: now,
          lastObservedState: observedState,
          updatedAt: now,
        })
        .where(eq(followUps.id, followUp.id));
    }

    return check;
  } catch (error) {
    // `attemptedAt` moves even though `checkedAt` does not. The UI keeps showing
    // the age of the last successful result, while the scheduler can see that
    // this row has had its turn and rotate it behind the rows that have not.
    await typedDb
      .update(followUps)
      .set({ attemptedAt: now, updatedAt: now })
      .where(eq(followUps.id, followUp.id));

    providerLogger.warn(
      { issueId: issue.id, provider: providerName, error: String(error) },
      "Follow-up check failed; previous result left in place"
    );
    return null;
  }
}

/**
 * Record that a row has had its turn, without claiming it was checked.
 *
 * `attemptedAt` drives scheduling and `checkedAt` means "the last completed
 * check", so a skip moves only the former. The UI keeps showing the age of the
 * last real result while the scheduler rotates this row behind the others.
 *
 * @param followUpId - The follow-up row that was passed over.
 */
async function markAttempted(followUpId: string): Promise<void> {
  const now = new Date();
  await typedDb
    .update(followUps)
    .set({ attemptedAt: now, updatedAt: now })
    .where(eq(followUps.id, followUpId));
}

/** The issue and repository fields a baseline read needs. */
interface WaitingIssue {
  issueId: string;
  repoId: string;
  number: number;
  title: string;
  url: string;
  state: "open" | "closed";
  provider: ProviderName;
  owner: string;
  name: string;
  fullName: string;
}

/**
 * Load one of the user's issues for arming.
 *
 * @returns The issue, or `null` when it is not the user's.
 */
async function loadWaitingIssue(userId: string, issueId: string): Promise<WaitingIssue | null> {
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
    number: row.issue.number,
    title: row.issue.title,
    url: row.issue.url,
    state: row.issue.state === "open" ? "open" : "closed",
    provider: row.repo.provider as ProviderName,
    owner: row.repo.owner,
    name: row.repo.name,
    fullName: row.repo.fullName,
  };
}

/**
 * Read the newest comment for a baseline.
 *
 * Failure is not fatal: an unreadable provider yields an empty baseline, which
 * means "anything from now on is new". Erring towards a possible extra
 * resurface is the safer direction than missing a reply entirely.
 */
async function readBaseline(
  userId: string,
  target: WaitingIssue
): Promise<{ commentId: string | null; at: Date | null }> {
  const provider = getProvider(target.provider);
  if (!provider.fetchComments) return { commentId: null, at: null };

  const token = await getProviderToken(userId, target.provider);
  if (!token) return { commentId: null, at: null };

  try {
    const page = await provider.fetchComments(target.owner, target.name, target.number, token, {
      limit: 1,
    });
    const newest = newestComment(page.comments);
    return { commentId: newest?.id ?? null, at: newest?.createdAt ?? null };
  } catch (error) {
    providerLogger.warn(
      { issueId: target.issueId, error: String(error) },
      "Baseline read failed; arming with an empty baseline"
    );
    return { commentId: null, at: null };
  }
}

/**
 * Shape a row for the client.
 *
 * @param target - Identity and display fields.
 * @param state - The persisted follow-up state.
 */
function toEntry(
  target: Omit<WaitingIssue, "owner" | "name" | "provider"> & {
    provider: string;
  },
  state: {
    state: FollowUpEntry["state"];
    reason: FollowUpReason | null;
    checkedAt: Date | null;
    due: boolean;
  }
): FollowUpEntry {
  return {
    issueId: target.issueId,
    repoId: target.repoId,
    number: target.number,
    title: target.title,
    url: target.url,
    provider: target.provider,
    fullName: target.fullName,
    state: state.state,
    reason: state.reason,
    checkedAt: state.checkedAt?.toISOString() ?? null,
    due: state.due,
  };
}

/** Follow-up states an issue can be in, for the query filter. */
export const FOLLOW_UP_STATES = ["waiting", "reviewed", "stopped"] as const;

/**
 * Load the follow-up rows for a set of issues.
 *
 * Used by the queue overlay so the inbox can mark issues it is already waiting
 * on without one query per row.
 *
 * @param userId - The authenticated user.
 * @param issueIds - The issues to look up.
 * @returns A map from issue id to its follow-up state.
 */
export async function followUpStatesFor(
  userId: string,
  issueIds: string[]
): Promise<Map<string, FollowUpEntry["state"]>> {
  if (issueIds.length === 0) return new Map();

  const rows = await typedDb
    .select({ issueId: followUps.issueId, state: followUps.state })
    .from(followUps)
    .where(and(eq(followUps.userId, userId), inArray(followUps.issueId, issueIds)));

  return new Map(rows.map((row) => [row.issueId, row.state as FollowUpEntry["state"]]));
}
