/**
 * @module replies/send-state
 *
 * The small state machine behind "did my comment actually go out?".
 *
 * Posting an issue comment is not idempotent on either provider: there is no
 * client-supplied key, so a request that timed out may have created the comment
 * or not, and the two are indistinguishable at the transport layer. Retrying
 * blindly risks a duplicate public reply, which is the one mistake here that
 * cannot be undone.
 *
 * So the client does not retry. It records that an attempt started, and until
 * the outcome is confirmed the draft is `unconfirmed`: Send is not offered, and
 * the user is told to check the provider. A confirmed success clears the draft;
 * a confirmed failure restores it for editing.
 */

/** What the composer is allowed to do for one draft right now. */
export type ReplySendState =
  /** Nothing has been sent; the body is editable and Send is available. */
  | "editable"
  /** A send is in flight; the composer is locked. */
  | "sending"
  /** A send started and its outcome is unknown; Send is withheld. */
  | "unconfirmed"
  /** The last send was confirmed; the draft has been cleared. */
  | "sent";

/** The stored draft fields the state is derived from. */
export interface ReplyDraftShape {
  body: string;
  sendAttemptedAt: string | null;
  version: number;
}

/**
 * Derive the composer's state from a stored draft.
 *
 * `sendAttemptedAt` is the marker of an unfinished attempt: the server sets it
 * immediately before contacting the provider and clears it only once the
 * outcome is known, so its presence means "we do not know" rather than "it
 * failed".
 *
 * `unconfirmed` covers the case the stored draft cannot. When the response is
 * lost after the provider accepted the comment, the server has already deleted
 * the draft, so a refetch returns nothing and the marker is gone. The client
 * still knows an outcome is unknown, and without this the composer would offer
 * Send again on a reply that is already public.
 *
 * @param draft - The stored draft, or `null` when there is none.
 * @param sending - Whether a send is currently in flight in this client.
 * @param unconfirmed - Whether this client saw an ambiguous outcome it has not
 *   been able to resolve.
 * @returns The state the composer should render.
 */
export function replySendState(
  draft: ReplyDraftShape | null,
  sending: boolean,
  unconfirmed = false
): ReplySendState {
  if (sending) return "sending";
  if (unconfirmed) return "unconfirmed";
  if (draft?.sendAttemptedAt) return "unconfirmed";
  return "editable";
}

/**
 * Report whether the Send control may be offered.
 *
 * Deliberately false for `unconfirmed`: offering Send again would invite the
 * duplicate this module exists to prevent.
 *
 * @param state - The composer's current state.
 * @param body - The text that would be sent.
 * @returns Whether Send should be enabled.
 */
export function canSend(state: ReplySendState, body: string): boolean {
  return state === "editable" && body.trim().length > 0;
}

/**
 * Describe an unconfirmed send to the user.
 *
 * The wording is specific on purpose: a generic "something went wrong" invites
 * the user to press the button again, which is exactly the wrong action.
 *
 * @param providerUrl - A link to the issue on the provider, when known.
 * @returns The sentence shown in the composer.
 */
export function unconfirmedNotice(providerUrl: string | null): string {
  const base =
    "This reply may already be posted. Check the issue before sending again, so the reporter does not get it twice.";
  return providerUrl ? `${base} ${providerUrl}` : base;
}
