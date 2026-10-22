import { typedDb } from "@/lib/db/query";
import { rateLimitBuckets } from "@/lib/db/schema";
import { lt, sql } from "drizzle-orm";
import { authLogger } from "@/lib/logger";
/**
 * @module lib/rate-limit
 *
 * Provides in-memory rate limiting capabilities.
 * Designed to protect sensitive endpoints (like authentication) from brute-force
 * and denial-of-service (DoS) attacks.
 */

/**
 * Longest window any rate-limit scope uses.
 *
 * The shared bucket table is purged opportunistically, and that purge must
 * never remove a bucket that is still inside *some* scope's window — a short
 * window scope purging the table would otherwise reset the long window scopes
 * and hand every caller a fresh allowance.
 */
const LONGEST_WINDOW_MS = 15 * 60 * 1000;

/**
 * A sliding-window rate limiter utilizing an in-memory Map.
 * Includes memory-protection mechanisms (maxEntries) to prevent out-of-memory
 * scenarios if an attacker attempts to flood with random IP addresses.
 */
export class RateLimiter {
  private map = new Map<string, { count: number; timestamp: number; windowMs: number }>();
  private readonly maxEntries: number;
  private readonly windowMs: number;

  constructor(options: { maxEntries?: number; windowMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 10000;
    this.windowMs = options.windowMs ?? LONGEST_WINDOW_MS;
  }

  /**
   * Checks if a key is rate limited and increments its count.
   * Cleans up expired entries before checking.
   *
   * @param key The bucket key (already scoped, e.g. `pat:validate:203.0.113.4`).
   * @param limit The maximum number of allowed hits in the window.
   * @param windowMs The window for this key; defaults to the limiter's window.
   * @returns true if rate limited, false otherwise.
   */
  public isRateLimited(key: string, limit: number, windowMs = this.windowMs): boolean {
    const now = Date.now();

    // 1. Cleanup old entries
    for (const [entryKey, value] of this.map.entries()) {
      if (now - value.timestamp > value.windowMs) {
        this.map.delete(entryKey);
      }
    }

    // 2. Prevent OOM by enforcing a max map size if it is getting too large
    // Evict random or oldest entries if we really have to. Since JS Map preserves
    // insertion order, the first few entries are the oldest remaining.
    if (this.map.size >= this.maxEntries && !this.map.has(key)) {
      const keysToDelete = Array.from(this.map.keys()).slice(0, 100);
      for (const entryKey of keysToDelete) {
        this.map.delete(entryKey);
      }
    }

    // 3. Get or initialize record
    const record = this.map.get(key) || { count: 0, timestamp: now, windowMs };
    record.count++;
    this.map.set(key, record);

    return record.count > limit;
  }
}

// Global singleton instance used when the database-backed limiter is unavailable
export const patRateLimiter = new RateLimiter();

/**
 * Database-backed rate limiter shared across application instances.
 *
 * @param key - Bucket key. Callers namespace it per scope (see
 *              `rateLimitKey`), so independent limits never share a counter.
 * @param limit - Maximum number of allowed hits in the window.
 * @param windowMs - Length of the window for this scope.
 * @returns True when the caller is over the limit.
 */
export async function checkPersistentRateLimit(
  key: string,
  limit: number,
  windowMs = LONGEST_WINDOW_MS
): Promise<boolean> {
  const now = Date.now();
  // Purge expired buckets opportunistically to prevent unbounded growth. The
  // horizon is the longest window in use, not this scope's window: purging on
  // a shorter horizon would delete buckets that are still live for another
  // scope and silently reset that scope's allowance.
  const purgeHorizon = Math.max(windowMs, LONGEST_WINDOW_MS);
  try {
    await typedDb
      .delete(rateLimitBuckets)
      .where(lt(rateLimitBuckets.windowStart, new Date(now - purgeHorizon)));
  } catch {
    // Best-effort cleanup must not disable auth-rate limiting.
  }

  try {
    const result = await typedDb
      .insert(rateLimitBuckets)
      .values({ key, count: 1, windowStart: new Date(now) })
      .onConflictDoUpdate({
        target: rateLimitBuckets.key,
        set: {
          count: sql`CASE WHEN ${rateLimitBuckets.windowStart} + ${windowMs} < ${now} THEN 1 ELSE ${rateLimitBuckets.count} + 1 END`,
          windowStart: sql`CASE WHEN ${rateLimitBuckets.windowStart} + ${windowMs} < ${now} THEN ${now} ELSE ${rateLimitBuckets.windowStart} END`,
        },
      })
      .returning({ count: rateLimitBuckets.count });

    // Persists windowStart as integer ms; compare against the same now value.
    return (result[0]?.count ?? 1) > limit;
  } catch (err) {
    authLogger.warn(
      { error: err instanceof Error ? err.message : String(err), key },
      "persistent rate limit failed; using in-memory limiter"
    );
    return patRateLimiter.isRateLimited(key, limit, windowMs);
  }
}
