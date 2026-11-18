/**
 * @module lib/provider-timing
 *
 * Timing constants shared by provider requests and the reply claim that protects
 * them.
 *
 * The two values are related, and that relationship is the reason they live
 * together. The send lease has to outlive the longest provider call it guards;
 * if it did not, a call could still be running when the claim expired and a
 * second send could start beside it. Writing the lease out as its own number
 * left nothing enforcing that, and the deadline lives in two adapters, so a
 * comment was the only link between them.
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
 * Derived rather than written out: raising the request deadline must raise the
 * lease with it. The margin covers the gap between the abort firing and the
 * request settling, so the lease always outlives the call.
 */
export const REPLY_SEND_LEASE_MS = REQUEST_TIMEOUT_MS * 2;
