/**
 * @module lib/request-context
 *
 * Derives request-scoped client identity for rate limiting.
 *
 * The only reason this module exists is that trusting a forwarding header
 * verbatim makes a rate limiter optional for the client. If the key can be
 * chosen by the caller, every request arrives under a new key and the limit
 * never triggers. Everything here narrows the set of headers we accept and
 * discards any part of the chain we did not receive from infrastructure we
 * control.
 *
 * Nothing the client sends is trustworthy on its own. `X-Forwarded-For` is a
 * chain each proxy appends the address it observed to, so only the entries
 * written by our own proxies can be believed — and only when we know how many
 * of them there are.
 */

/**
 * Assumed proxy depth when none is configured.
 *
 * Zero is the safe default: with no proxy in front of the app, no forwarding
 * header can be attributed to anyone, so requests share a single bucket
 * instead of minting a fresh one per spoofed header.
 */
const DEFAULT_TRUSTED_HOPS = 0;

/**
 * Parses `TRUSTED_PROXY_HOPS` into a non-negative integer.
 *
 * Falls back to the default rather than propagating `NaN`: an unparseable
 * value would make the hop selection index nonsense and could hand back an
 * attacker-controlled segment.
 *
 * @returns The number of proxies whose forwarding entries may be trusted.
 */
function trustedHopCount(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (!raw || raw.trim() === "") return DEFAULT_TRUSTED_HOPS;

  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_TRUSTED_HOPS;
}

/** Splits a forwarded-for chain into trimmed, non-empty hops. */
function parseChain(header: string): string[] {
  return header
    .split(",")
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
}

/**
 * Resolves the client IP for rate-limiting purposes.
 *
 * Trust model: `X-Forwarded-For` is a chain in which each proxy appends the
 * address it observed. The entries at the head were supplied by the client and
 * are therefore ignored; the value used is `TRUSTED_PROXY_HOPS` positions from
 * the end, where our own proxies wrote. Setting `TRUSTED_PROXY_HOPS` to match
 * the actual number of proxies is what keeps this sound — if it is set higher
 * than reality, attacker-supplied entries become reachable again.
 *
 * Platform headers such as `x-vercel-forwarded-for` or `cf-connecting-ip` are
 * deliberately not consulted: they are only trustworthy when the request
 * actually came through that platform, and nothing in the request proves it.
 * On a directly exposed deployment they are as forgeable as any other header.
 *
 * @param req - The incoming request.
 * @returns The client address, or `null` when no trustworthy address is available.
 */
export function clientIp(req: Request): string | null {
  const hops = trustedHopCount();
  if (hops === 0) return null;

  const forwardedFor = req.headers.get("x-forwarded-for");
  if (!forwardedFor) return null;

  const chain = parseChain(forwardedFor);
  // Too short to attribute — the chain does not contain enough entries
  // written by our own proxies.
  if (chain.length < hops) return null;

  return chain[chain.length - hops];
}

/**
 * Resolves the rate-limit key for a request.
 *
 * When the client cannot be identified — a bare local dev server with no proxy
 * in front of it — requests share a single bucket. That is deliberately the
 * strict direction: unattributable traffic shares one allowance rather than
 * minting a fresh one per request, and the key is a fixed constant so it cannot
 * be rotated by a caller who omits the headers.
 *
 * @param req - The incoming request, if the caller has one.
 * @param scope - Namespace isolating independent limits (for example
 *                `pat:validate` vs `pat:signin`) so one flow cannot exhaust
 *                another's allowance.
 * @returns A stable, non-spoofable rate-limit key.
 */
export function rateLimitKey(req: Request | undefined, scope: string): string {
  // A missing request resolves to the shared key rather than throwing, so a
  // caller that cannot supply headers still gets a bounded limit.
  const ip = req ? clientIp(req) : null;
  return `${scope}:${ip ?? "unattributed"}`;
}
