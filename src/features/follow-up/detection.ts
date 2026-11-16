/**
 * @module follow-up/detection
 *
 * Deciding whether an issue has genuinely come back for attention.
 *
 * Everything here is pure: given a baseline and a page of comments, it answers
 * "does this qualify, and why". That keeps the discrimination rules testable
 * without a provider, a database, or a clock — the three things that usually
 * make a feature like this impossible to pin down.
 *
 * The rules exist because a resurface is expensive: it interrupts the queue and
 * spends the user's attention. A false one is worse than a missing one, so the
 * checks are deliberately conservative and each one is stated as a reason the
 * caller can show rather than a silent filter.
 */
import type { ProviderComment } from "@/lib/provider-interface";

/** Why an issue came back. Stored verbatim, rendered to the user. */
export type FollowUpReason = "reply" | "reopened";

/**
 * Logins whose activity is machine-generated.
 *
 * A hard-coded list is a blunt instrument, and it is the honest one available
 * here: neither provider exposes "is this a bot" for an issue comment, and the
 * suffixes below are the conventions both use for their own automation. A
 * comment from a bot is not a reply a maintainer can act on, so treating it as
 * one would train the user to ignore the queue.
 *
 * A bare `bot` suffix is deliberately absent: it would classify real logins
 * such as `talbot` or `abbot` as automation, and mislabelling a person's reply
 * is the failure this list exists to prevent.
 */
const BOT_SUFFIXES = ["[bot]", "-bot", "_bot"];

/** The minimum a baseline needs to decide anything. */
export interface FollowUpBaseline {
  /** Highest comment id that had already been read, or `null` for "nothing seen". */
  lastSeenCommentId: string | null;
  /** Newest comment instant that had already been read, or `null`. */
  lastSeenCommentAt: Date | null;
  /** The issue's state when waiting was armed. */
  stateAtBaseline: "open" | "closed";
  /** The comment whose review dismissed the previous resurface. */
  reviewedCommentId: string | null;
}

/** The outcome of checking one issue. */
export interface FollowUpCheck {
  /** Whether the issue should be surfaced. */
  qualifies: boolean;
  /** Why, when it qualifies; `null` otherwise. */
  reason: FollowUpReason | null;
  /** The comment that triggered it, when a reply did. */
  trigger: ProviderComment | null;
}

/**
 * Report whether a login looks like automation.
 *
 * @param login - The comment author's login.
 * @returns `true` for a login that is almost certainly a bot.
 */
export function isBotLogin(login: string | null): boolean {
  if (!login) return false;
  const normalised = login.toLowerCase();
  return BOT_SUFFIXES.some((suffix) => normalised.endsWith(suffix));
}

/**
 * Compare two provider comment ids.
 *
 * Provider ids are numeric strings of different widths (GitHub's are far wider
 * than a 32-bit int), so comparing them as numbers is unsafe past 2^53 and
 * comparing them as plain strings is wrong for different lengths. Comparing by
 * digit length first and then lexically is exact for any width.
 *
 * @returns A negative number if `a` predates `b`, positive if it follows it, `0` if equal.
 */
export function compareCommentIds(a: string, b: string): number {
  const left = a.replace(/^0+(?=\d)/, "");
  const right = b.replace(/^0+(?=\d)/, "");
  if (left.length !== right.length) return left.length - right.length;
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Decide whether an issue should come back, and why.
 *
 * A comment qualifies only when all of the following hold:
 *
 * 1. It is not a system record (a label change is not a reply).
 * 2. It was written by somebody other than the signed-in user. Your own reply
 *    is progress, not news.
 * 3. It is not from a bot.
 * 4. It lands after the baseline, compared by id *and* by instant. Both are
 *    needed: timestamps can tie within a burst, and ids catch a comment the
 *    baseline's clock filter would miss.
 * 5. It is not the comment whose review dismissed the previous resurface, which
 *    would otherwise raise the same item every time the queue is opened.
 *
 * A reopen is a *transition*: the issue was closed when waiting was armed and is
 * open now. Merely being open is the normal case for a waiting issue and must
 * not qualify, or every armed issue would resurface immediately.
 *
 * @param baseline - What had already been read when the user chose to wait.
 * @param comments - One page of the issue's discussion, oldest first.
 * @param context - The user's own login and the issue's current state.
 * @returns The verdict, its reason, and the triggering comment.
 */
export function detectFollowUp(
  baseline: FollowUpBaseline,
  comments: ProviderComment[],
  context: { selfLogin: string | null; state: "open" | "closed" }
): FollowUpCheck {
  if (baseline.stateAtBaseline === "closed" && context.state === "open") {
    return { qualifies: true, reason: "reopened", trigger: null };
  }

  const self = context.selfLogin?.toLowerCase() ?? null;

  for (const comment of comments) {
    if (comment.isSystem) continue;
    if (self && comment.author?.toLowerCase() === self) continue;
    if (isBotLogin(comment.author)) continue;
    if (baseline.reviewedCommentId && comment.id === baseline.reviewedCommentId) continue;

    const isAfterBaselineAt =
      baseline.lastSeenCommentAt === null || comment.createdAt > baseline.lastSeenCommentAt;
    const isAfterBaselineId =
      baseline.lastSeenCommentId === null ||
      compareCommentIds(comment.id, baseline.lastSeenCommentId) > 0;

    if (isAfterBaselineAt && isAfterBaselineId) {
      return { qualifies: true, reason: "reply", trigger: comment };
    }
  }

  return { qualifies: false, reason: null, trigger: null };
}

/**
 * Pick the newest comment in a page, for storing as a fresh baseline.
 *
 * @param comments - A page of comments, oldest first.
 * @returns The newest comment, or `null` for an empty page.
 */
export function newestComment(comments: ProviderComment[]): ProviderComment | null {
  if (comments.length === 0) return null;
  return comments.reduce((newest, comment) =>
    compareCommentIds(comment.id, newest.id) > 0 ? comment : newest
  );
}

/** The one-line description a follow-up queue entry shows. */
export function describeFollowUpReason(reason: string | null): string {
  if (reason === "reply") return "Replied";
  if (reason === "reopened") return "Reopened";
  return "Waiting";
}
