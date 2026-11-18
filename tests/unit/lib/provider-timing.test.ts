/**
 * @module tests/unit/lib/provider-timing
 *
 * The send lease and the request deadline are one relationship, not two numbers.
 *
 * A provider call that can outlive the claim protecting it lets a second send
 * start while the first may still publish — the duplicate the claim exists to
 * prevent. These assertions fail if the lease is ever written out independently
 * and left below the deadline.
 */
import { describe, expect, it } from "vitest";
import { REPLY_SEND_LEASE_MS, REQUEST_TIMEOUT_MS } from "@/lib/provider-timing";

describe("provider timing", () => {
  it("should keep the send lease longer than the request deadline", () => {
    expect(REPLY_SEND_LEASE_MS).toBeGreaterThan(REQUEST_TIMEOUT_MS);
  });

  /**
   * @target REPLY_SEND_LEASE_MS
   * @dependencies REQUEST_TIMEOUT_MS
   * @scenario The lease is derived from the request deadline
   * @expectedOutput Four deadlines: one for the scheduling gap between the
   *                 claim landing and the call, one for the provider call, and
   *                 two for settlement and clock skew. The lease is stamped by
   *                 the database clock inside the claim write, so the write's
   *                 duration cannot shorten it.
   */
  it("should keep the lease at four request deadlines", () => {
    expect(REPLY_SEND_LEASE_MS).toBe(REQUEST_TIMEOUT_MS * 4);
  });
});
