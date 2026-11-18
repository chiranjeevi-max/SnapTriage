/**
 * @module lib/provider-timing
 *
 * Timing constants shared by provider requests and the reply claim that protects
 * them.
 *
 * The two values are related. The send lease has to outlive the claim's own
 * database writes and the longest provider call it guards. If it did not, a
 * call could still be running when the claim expired and a second send could
 * start beside it. Writing the lease out as its own number left nothing
 * enforcing that, and the deadline lives in two adapters, so a comment was the
 * only link between them.
 */

/**
 * Hard deadline for one provider HTTP request, including its retries.
 *
 * GitHub inherits one absolute deadline across a retry, so a rate-limit wait
 * cannot extend a call past it. GitLab does not retry at all, so its single
 * timer is the whole budget. Either way one call cannot exceed one timeout,
 * which is the property the lease below relies on.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * How long a reply send keeps its claim marked "in flight".
 *
 * Four request deadlines. `claimAttempt` stamps the lease with the database's
 * own clock inside the claim write, so the write's duration cannot shorten it,
 * however stalled. The deadlines cover the scheduling gap between the claim
 * landing and the call starting (which includes the database-side lease check's
 * round trip), the call itself, and settlement. The value is derived rather than
 * written out, so raising the request deadline raises the lease with it.
 * `sendReply` refuses to start a call with less than
 * {@link REPLY_SEND_MIN_LEASE_MS} of it remaining.
 */
export const REPLY_SEND_LEASE_MS = REQUEST_TIMEOUT_MS * 4;

/**
 * The least lease that must remain when the provider call starts.
 *
 * The lease is stamped when the claim is written, and everything between that
 * write and the call uses it up: delivering the response, scheduling, a slow
 * database. `sendReply` checks the claim against this floor in the database, so
 * the comparison uses the same clock that stamped the lease. A lease with less
 * than this left refuses the send instead of starting a call it cannot cover
 * for the call's full duration. One request deadline plus a settle margin; the
 * margin covers the select's response and the dispatch between the check and the
 * fetch. On SQLite, the clock's whole-second truncation can spend up to a second
 * of that margin at the boundary; the error is one-sided and leaves several
 * seconds.
 */
export const REPLY_SEND_MIN_LEASE_MS = REQUEST_TIMEOUT_MS + 5_000;
