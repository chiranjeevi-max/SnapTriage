/**
 * @module tests/unit/features/triage/use-triage-mutation
 *
 * The decision about whether a finished write should refetch. It is separated
 * from the hook because the case that matters is invisible in a normal render:
 * a write the provider accepted but the server could not record.
 */
import { describe, expect, it } from "vitest";
import { shouldRefetchAfterWrite } from "@/features/triage/use-triage-mutation";

describe("shouldRefetchAfterWrite", () => {
  /**
   * @target shouldRefetchAfterWrite
   * @dependencies none
   * @scenario The server accepted the change and recorded it
   * @expectedOutput A refetch, so the queue and the detail pane show the result.
   */
  it("refetches after an ordinary success", () => {
    expect(shouldRefetchAfterWrite({ ok: true })).toBe(true);
  });

  /**
   * @target shouldRefetchAfterWrite
   * @dependencies none
   * @scenario The provider accepted the change but recording it locally failed
   * @expectedOutput No refetch. The local row still holds the pre-write values,
   *                 so refetching replaces the optimistic update with them and
   *                 the user watches a successful action revert.
   */
  it("does not refetch when the response carries a warning", () => {
    expect(
      shouldRefetchAfterWrite({ ok: true, warning: "accepted, but not recorded locally" })
    ).toBe(false);
  });

  it("refetches when the response is missing or not an object", () => {
    expect(shouldRefetchAfterWrite(undefined)).toBe(true);
    expect(shouldRefetchAfterWrite(null)).toBe(true);
  });
});

describe("mayRollBack", () => {
  /**
   * @target mayRollBack
   * @dependencies beginWrite
   * @scenario A single write fails with no later write behind it
   * @expectedOutput It may roll back, so an ordinary failure still restores.
   */
  it("allows the newest write to roll back", async () => {
    const { beginWrite, mayRollBack } = await import("@/features/triage/use-triage-mutation");

    const first = beginWrite("issue-alone");

    expect(mayRollBack("issue-alone", first)).toBe(true);
  });

  /**
   * @target mayRollBack
   * @dependencies beginWrite
   * @scenario Two writes for one issue overlap and the first fails
   * @expectedOutput The first may not roll back. Its snapshot predates the second
   *                 write, so restoring it would also discard the second write's
   *                 optimistic state and two quick keystrokes would lose one.
   */
  it("refuses a rollback that a later write has superseded", async () => {
    const { beginWrite, mayRollBack } = await import("@/features/triage/use-triage-mutation");

    const first = beginWrite("issue-racy");
    const second = beginWrite("issue-racy");

    expect(mayRollBack("issue-racy", first)).toBe(false);
    expect(mayRollBack("issue-racy", second)).toBe(true);
  });

  /**
   * @target mayRollBack
   * @dependencies beginWrite
   * @scenario A write fails for an issue whose newer write is a different issue
   * @expectedOutput The stamps are per issue, so an unrelated write cannot block
   *                 this rollback.
   */
  it("tracks the newest write per issue", async () => {
    const { beginWrite, mayRollBack } = await import("@/features/triage/use-triage-mutation");

    const mine = beginWrite("issue-a");
    beginWrite("issue-b");

    expect(mayRollBack("issue-a", mine)).toBe(true);
  });
});
