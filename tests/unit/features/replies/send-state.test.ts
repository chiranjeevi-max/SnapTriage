/**
 * @module tests/unit/features/replies/send-state
 *
 * The composer's send rules.
 *
 * These are pure functions, so they are pinned exactly rather than observed
 * through a component. The one that matters is `canSend("unconfirmed")`: a
 * `true` there is the difference between telling the user their reply may
 * already be posted and posting it a second time in front of the reporter.
 */
import { describe, it, expect } from "vitest";
import {
  canSend,
  replySendState,
  unconfirmedNotice,
  type ReplyDraftShape,
  type ReplySendState,
} from "@/features/replies/send-state";

/** A saved draft that is ready to send. */
function draft(overrides: Partial<ReplyDraftShape> = {}): ReplyDraftShape {
  return { body: "Thanks, reproduced.", sendAttemptedAt: null, version: 1, ...overrides };
}

/** Every state the composer can be in, for the exhaustive tables below. */
const ALL_STATES: ReplySendState[] = ["editable", "sending", "unconfirmed", "sent"];

describe("replySendState", () => {
  /**
   * @target replySendState
   * @dependencies ReplyDraftShape
   * @scenario The provider accepted the reply but the response was lost, so the
   *           server already deleted the draft and a refetch returns nothing
   * @expectedOutput `unconfirmed`, even though no stored draft records an
   *                 attempt. The absence of a draft cannot prove the post failed,
   *                 and offering Send again would publish a second reply.
   */
  it("should stay unconfirmed when the outcome is unknown but the draft is gone", () => {
    expect(replySendState(null, false, true)).toBe("unconfirmed");
  });

  /**
   * @target replySendState
   * @dependencies ReplyDraftShape
   * @scenario A send is in flight while the previous attempt is still latched
   * @expectedOutput `sending` wins: the composer is locked either way, and
   *                 `sending` is the state that shows progress
   */
  it("should report sending ahead of a latched unconfirmed outcome", () => {
    expect(replySendState(draft(), true, true)).toBe("sending");
  });

  /**
   * @target replySendState
   * @dependencies ReplyDraftShape
   * @scenario A saved draft with no attempt recorded
   * @expectedOutput `editable`, which is what makes the body writable and Send available
   */
  it("should report editable for a draft with no attempt", () => {
    expect(replySendState(draft(), false)).toBe("editable");
  });

  /**
   * @target replySendState
   * @dependencies ReplyDraftShape
   * @scenario The composer has never saved a draft for this issue
   * @expectedOutput `editable`: an unsaved composer is usable, not blocked
   */
  it("should report editable when there is no draft at all", () => {
    expect(replySendState(null, false)).toBe("editable");
  });

  /**
   * @target replySendState
   * @dependencies ReplyDraftShape
   * @scenario A send is in flight in this client
   * @expectedOutput `sending`
   */
  it("should report sending while a request is in flight", () => {
    expect(replySendState(draft(), true)).toBe("sending");
  });

  /**
   * @target replySendState
   * @dependencies ReplyDraftShape
   * @scenario An attempt is unresolved and this client is also mid-flight
   * @expectedOutput `sending` wins: the in-flight request is the more specific fact
   */
  it("should report sending ahead of an unresolved attempt", () => {
    const inFlight = draft({ sendAttemptedAt: "2026-03-01T00:00:00.000Z" });

    expect(replySendState(inFlight, true)).toBe("sending");
  });

  /**
   * @target replySendState
   * @dependencies ReplyDraftShape
   * @scenario The server recorded an attempt that has no known outcome
   * @expectedOutput `unconfirmed`, because a present `sendAttemptedAt` means "we
   *                 do not know", not "it failed"
   */
  it("should report unconfirmed for an attempt with no known outcome", () => {
    const attempted = draft({ sendAttemptedAt: "2026-03-01T00:00:00.000Z" });

    expect(replySendState(attempted, false)).toBe("unconfirmed");
  });

  /**
   * @target replySendState
   * @dependencies ReplyDraftShape
   * @scenario The provider rejected the reply definitively, so the server cleared
   *           the attempt marker
   * @expectedOutput `editable` with the text intact
   */
  it("should report editable again once the attempt marker is cleared", () => {
    const rejected = draft({ body: "Kept text", sendAttemptedAt: null });

    expect(replySendState(rejected, false)).toBe("editable");
    expect(rejected.body).toBe("Kept text");
  });
});

describe("canSend", () => {
  /**
   * @target canSend
   * @dependencies replySendState
   * @scenario An editable composer holding text
   * @expectedOutput `true`
   */
  it("should allow a send from an editable composer with text", () => {
    expect(canSend("editable", "Thanks")).toBe(true);
  });

  /**
   * @target canSend
   * @dependencies replySendState
   * @scenario The body is empty, or nothing but whitespace
   * @expectedOutput `false`: a blank comment is not a reply, and the providers
   *                 reject one anyway
   */
  it("should refuse an empty or whitespace-only body", () => {
    expect(canSend("editable", "")).toBe(false);
    expect(canSend("editable", "   \n\t ")).toBe(false);
  });

  /**
   * @target canSend
   * @dependencies replySendState
   * @scenario A send is in flight
   * @expectedOutput `false`, so a double click cannot issue two POSTs
   */
  it("should refuse while a request is in flight", () => {
    expect(canSend("sending", "Thanks")).toBe(false);
  });

  /**
   * @target canSend
   * @dependencies replySendState
   * @scenario The previous send's outcome is unknown, with a non-empty body so
   *           the text cannot be what refuses it
   * @expectedOutput `false`: offering Send here is the duplicate this module exists
   *                 to prevent
   */
  it("should refuse while an earlier outcome is unknown", () => {
    expect(canSend("unconfirmed", "Thanks, reproduced.")).toBe(false);
  });

  /**
   * @target canSend
   * @dependencies replySendState
   * @scenario The reply was confirmed and the draft cleared
   * @expectedOutput `false`
   */
  it("should refuse once the reply has been sent", () => {
    expect(canSend("sent", "Thanks")).toBe(false);
  });

  /**
   * @target canSend
   * @dependencies replySendState
   * @scenario Every state, with text that would otherwise be sendable
   * @expectedOutput `true` for `editable` alone
   */
  it("should allow exactly one of the four states", () => {
    const allowed = ALL_STATES.filter((state) => canSend(state, "Thanks"));

    expect(allowed).toEqual(["editable"]);
  });
});

describe("unconfirmedNotice", () => {
  /**
   * @target unconfirmedNotice
   * @dependencies none
   * @scenario The provider URL is not known
   * @expectedOutput The warning sentence on its own, naming the duplicate risk
   *                 rather than a generic failure
   */
  it("should warn about the duplicate without a link", () => {
    const notice = unconfirmedNotice(null);

    expect(notice).toContain("may already be posted");
    expect(notice).toContain("twice");
  });

  /**
   * @target unconfirmedNotice
   * @dependencies none
   * @scenario The issue's provider URL is known
   * @expectedOutput The same warning with the URL appended, so the user can go
   *                 and check instead of guessing
   */
  it("should append the issue link when one is known", () => {
    const notice = unconfirmedNotice("https://github.com/octo/repo/issues/7");

    expect(notice).toContain("https://github.com/octo/repo/issues/7");
    expect(notice).toContain(unconfirmedNotice(null));
  });
});
