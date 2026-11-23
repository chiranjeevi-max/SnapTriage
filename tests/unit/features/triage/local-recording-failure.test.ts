/**
 * @module tests/unit/features/triage/local-recording-failure
 *
 * What the user is told when the provider accepted a write the server could not
 * record. The message has to match what actually reconciles: a sync rewrites the
 * issue row, but it never touches `triage_state`, so personal settings are lost.
 * Promising they will catch up would be a claim the app cannot keep.
 */
import { describe, expect, it } from "vitest";
import { localRecordingFailureMessage } from "@/features/triage/triage-service";

describe("localRecordingFailureMessage", () => {
  /**
   * @target localRecordingFailureMessage
   * @dependencies none
   * @scenario Only provider fields were written
   * @expectedOutput A message naming the next sync, which is what repairs the
   *                 issue row from the provider.
   */
  it("promises a sync when only provider fields changed", () => {
    const message = localRecordingFailureMessage("github", { labels: { add: ["bug"] } });

    expect(message).toContain("next sync will catch up");
    expect(message).not.toContain("set again");
  });

  /**
   * @target localRecordingFailureMessage
   * @dependencies none
   * @scenario A combined write: a label and a priority
   * @expectedOutput A message that separates the two. The label catches up from
   *                 the provider; the priority is lost, because sync never writes
   *                 `triage_state`.
   */
  it("says personal settings may need setting again in a combined write", () => {
    const message = localRecordingFailureMessage("gitlab", {
      labels: { add: ["bug"] },
      priority: 1,
    });

    expect(message).toContain("provider side will catch up");
    expect(message).toContain("may need to be set again");
  });

  /**
   * @target localRecordingFailureMessage
   * @dependencies none
   * @scenario Only personal fields were written
   * @expectedOutput No mention of a sync. Nothing upstream holds them, so the
   *                 message must not imply a repair that will not happen.
   */
  it("does not promise a sync when only personal fields changed", () => {
    for (const payload of [{ priority: 2 }, { snoozedUntil: null }, { dismissed: true }]) {
      const message = localRecordingFailureMessage("github", payload);

      expect(message).not.toContain("sync");
      expect(message).toContain("could not be saved");
    }
  });
});
