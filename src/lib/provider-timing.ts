/**
 * @module lib/provider-timing
 *
 * Timing constants shared by provider requests and the reply claim that protects
 * them.
 *
 * The two values are related, and that relationship is the reason they live
 * together. The send lease has to outlive the claim's own database writes and
 * the longest provider call it guards; if it did not, a call could still be
 * running when the claim expired and a second send could start beside it.
 * Writing the lease out as its own number left nothing enforcing that, and the
 * deadline lives in two adapters, so a comment was the only link between them.
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
 * own clock inside the claim write, so the write's duration — however stalled —
 * cannot shorten it. The deadlines then cover the scheduling gap between the
 * claim landing and the call starting, the call itself, settlement, and the skew
 * between the database's clock and the app that later compares the lease. Derived
 * rather than written out, so raising the request deadline raises the lease with
 * it.
 */
export const REPLY_SEND_LEASE_MS = REQUEST_TIMEOUT_MS * 4;
