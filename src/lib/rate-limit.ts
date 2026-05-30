/**
 * @module lib/rate-limit
 *
 * Provides in-memory rate limiting capabilities.
 * Designed to protect sensitive endpoints (like authentication) from brute-force
 * and denial-of-service (DoS) attacks.
 */

/**
 * A sliding-window rate limiter utilizing an in-memory Map.
 * Includes memory-protection mechanisms (maxEntries) to prevent out-of-memory
 * scenarios if an attacker attempts to flood with random IP addresses.
 */
export class RateLimiter {
  private map = new Map<string, { count: number; timestamp: number }>();
  private readonly maxEntries: number;
  private readonly windowMs: number;

  constructor(options: { maxEntries?: number; windowMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 10000;
    this.windowMs = options.windowMs ?? 15 * 60 * 1000; // 15 mins default
  }

  /**
   * Checks if an IP is rate limited and increments its count.
   * Cleans up expired entries before checking.
   *
   * @param ip The IP address string.
   * @param limit The maximum number of allowed hits in the window.
   * @returns true if rate limited, false otherwise.
   */
  public isRateLimited(ip: string, limit: number): boolean {
    const now = Date.now();

    // 1. Cleanup old entries
    for (const [key, value] of this.map.entries()) {
      if (now - value.timestamp > this.windowMs) {
        this.map.delete(key);
      }
    }

    // 2. Prevent OOM by enforcing a max map size if it is getting too large
    // Evict random or oldest entries if we really have to. Since JS Map preserves
    // insertion order, the first few entries are the oldest remaining.
    if (this.map.size >= this.maxEntries && !this.map.has(ip)) {
      const keysToDelete = Array.from(this.map.keys()).slice(0, 100);
      for (const key of keysToDelete) {
        this.map.delete(key);
      }
    }

    // 3. Get or initialize record
    const record = this.map.get(ip) || { count: 0, timestamp: now };
    record.count++;
    this.map.set(ip, record);

    return record.count > limit;
  }
}

// Global singleton instance for the PAT endpoint
export const patRateLimiter = new RateLimiter();
