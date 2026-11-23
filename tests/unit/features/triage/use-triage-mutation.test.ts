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
