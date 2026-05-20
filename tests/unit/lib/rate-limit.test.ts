import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { RateLimiter } from "@/lib/rate-limit";

describe("RateLimiter", () => {
  let rateLimiter: RateLimiter;

  beforeEach(() => {
    vi.useFakeTimers();
    rateLimiter = new RateLimiter({ windowMs: 1000, maxEntries: 2 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should allow requests under the limit", () => {
    expect(rateLimiter.isRateLimited("127.0.0.1", 2)).toBe(false); // hit 1
    expect(rateLimiter.isRateLimited("127.0.0.1", 2)).toBe(false); // hit 2
  });

  it("should block requests over the limit", () => {
    rateLimiter.isRateLimited("127.0.0.1", 2); // hit 1
    rateLimiter.isRateLimited("127.0.0.1", 2); // hit 2
    expect(rateLimiter.isRateLimited("127.0.0.1", 2)).toBe(true); // hit 3
  });

  it("should reset after windowMs passes", () => {
    rateLimiter.isRateLimited("127.0.0.1", 1); // hit 1
    expect(rateLimiter.isRateLimited("127.0.0.1", 1)).toBe(true); // hit 2, blocked

    vi.advanceTimersByTime(1500);

    // Should be allowed again since old entry was cleaned up
    expect(rateLimiter.isRateLimited("127.0.0.1", 1)).toBe(false); // hit 1 again
  });

  it("should enforce maxEntries limit", () => {
    rateLimiter.isRateLimited("127.0.0.1", 5);
    rateLimiter.isRateLimited("127.0.0.2", 5);

    // At this point map size is 2 (the max). If we add another, the oldest should be evicted.
    rateLimiter.isRateLimited("127.0.0.3", 5);

    // If we hit 127.0.0.1 again, it should start from count 1 because it was evicted.
    // So the first hit will return false (1 > 1 is false).
    expect(rateLimiter.isRateLimited("127.0.0.1", 1)).toBe(false); 
    
    // We expect it to be blocked now since count will be 2 (2 > 1 is true).
    expect(rateLimiter.isRateLimited("127.0.0.1", 1)).toBe(true); 
  });
});
