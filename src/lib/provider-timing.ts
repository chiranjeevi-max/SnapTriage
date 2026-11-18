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
 * landing and the call starting, the call itself, settlement, and the skew
 * between the database's clock and the app that checks it before the call. The
 * value is derived rather than written out, so raising the request deadline
 * raises the lease with it. `sendReply` refuses to start a call with less than
 * {@link REPLY_SEND_MIN_LEASE_MS} of it remaining.
 */
export const REPLY_SEND_LEASE_MS = REQUEST_TIMEOUT_MS * 4;

/**
 * The least lease that must remain when the provider call starts.
 *
 * The lease is stamped when the claim is written, and everything between that
 * write and the call uses it up: delivering the response, scheduling, a
 * database clock running behind the app's. `sendReply` checks the claim's
 * returned deadline against this floor before any provider call, so a lease
 * that arrives mostly spent refuses the send instead of starting a call it
 * cannot cover for the call's full duration. One request deadline plus a settle
 * margin. The margin also covers the synchronous dispatch between the check and
 * the fetch, and the skew of a database clock running ahead of this instance's.
 * The guard measures in the app's frame while the lease and the release both
 * live in the database's, so a database clock ahead by more than the margin
 * would let the guard pass a call the lease cannot cover.
 */
export const REPLY_SEND_MIN_LEASE_MS = REQUEST_TIMEOUT_MS + 5_000;
