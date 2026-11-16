/**
 * @module tests/unit/features/presets/types
 *
 * The preset resolver is the one place that decides what a preset actually
 * does to an issue. These tests pin the properties the rest of the feature
 * depends on:
 *
 * - A preset only adds; it never removes something the issue already had.
 * - Re-applying a preset to an issue that already satisfies it changes nothing.
 * - The preview lines and the payload always agree.
 * - The inverse restores exactly what the resolution changed.
 */
import { describe, expect, it } from "vitest";
import {
  describeResolution,
  effectiveTriageState,
  invertResolution,
  invertToPayload,
  resolvePreset,
  type PresetActions,
  type ResolvableIssue,
} from "@/features/presets/types";
import { mergePendingChanges } from "@/features/triage/types";

/** An issue with no labels and no assignees, whose priority has never been set. */
function issue(overrides: Partial<ResolvableIssue> = {}): ResolvableIssue {
  return {
    labels: [],
    assignees: [],
    triage: { priority: null },
    ...overrides,
  } as ResolvableIssue;
}

describe("resolvePreset", () => {
  it("adds every configured value to an issue that has none", () => {
    const actions: PresetActions = {
      priority: 1,
      labels: { add: ["bug", "confirmed"] },
      assignees: { add: ["jo"] },
    };

    const resolution = resolvePreset(actions, issue());

    expect(resolution.noChange).toBe(false);
    expect(resolution.payload).toEqual({
      priority: 1,
      labels: { add: ["bug", "confirmed"] },
      assignees: { add: ["jo"] },
    });
  });

  it("does not re-add a label or assignee the issue already has", () => {
    const actions: PresetActions = {
      labels: { add: ["bug", "confirmed"] },
      assignees: { add: ["jo"] },
    };

    const resolution = resolvePreset(
      actions,
      issue({ labels: ["bug"], assignees: ["jo"], triage: { priority: null } })
    );

    expect(resolution.payload).toEqual({ labels: { add: ["confirmed"] } });
    expect(resolution.noChange).toBe(false);
  });

  it("treats an already-satisfied preset as no change", () => {
    const actions: PresetActions = {
      priority: 2,
      labels: { add: ["bug"] },
      assignees: { add: ["jo"] },
    };

    const resolution = resolvePreset(
      actions,
      issue({ labels: ["bug"], assignees: ["jo"], triage: { priority: 2 } })
    );

    expect(resolution.noChange).toBe(true);
    expect(resolution.payload).toEqual({});
  });

  it("compares label and assignee names case-insensitively", () => {
    const actions: PresetActions = {
      labels: { add: ["Bug"] },
      assignees: { add: ["JO"] },
    };

    const resolution = resolvePreset(actions, issue({ labels: ["bug"], assignees: ["jo"] }));

    expect(resolution.noChange).toBe(true);
  });

  it("distinguishes an omitted priority from a null one", () => {
    const omitted = resolvePreset({ labels: { add: ["bug"] } }, issue({ triage: { priority: 2 } }));
    const cleared = resolvePreset({ priority: null }, issue({ triage: { priority: 2 } }));

    expect(omitted.payload.priority).toBeUndefined();
    expect(cleared.payload.priority).toBeNull();
  });

  it("does not clear a priority that is already unset", () => {
    const resolution = resolvePreset({ priority: null }, issue({ triage: { priority: null } }));

    expect(resolution.noChange).toBe(true);
  });

  it("sets a priority on an issue that has never been triaged", () => {
    const resolution = resolvePreset({ priority: 0 }, issue({ triage: null }));

    expect(resolution.payload.priority).toBe(0);
    expect(resolution.noChange).toBe(false);
  });

  it("deduplicates a label repeated inside one preset", () => {
    const resolution = resolvePreset({ labels: { add: ["bug", "bug"] } }, issue());

    expect(resolution.payload.labels?.add).toEqual(["bug"]);
  });

  it("preserves unrelated labels on the issue", () => {
    const resolution = resolvePreset(
      { labels: { add: ["bug"] } },
      issue({ labels: ["documentation", "good first issue"] })
    );

    expect(resolution.payload.labels).toEqual({ add: ["bug"] });
  });
});

describe("resolvePreset preview", () => {
  it("marks added values with + and existing ones with =", () => {
    const resolution = resolvePreset(
      { labels: { add: ["bug", "triage"] } },
      issue({ labels: ["bug"] })
    );

    expect(resolution.changes).toEqual([
      { kind: "label", value: "bug", operation: "=" },
      { kind: "label", value: "triage", operation: "+" },
    ]);
  });

  it("reports a cleared priority with - and the outgoing value", () => {
    const resolution = resolvePreset({ priority: null }, issue({ triage: { priority: 3 } }));

    expect(resolution.changes).toEqual([{ kind: "priority", value: "P3", operation: "-" }]);
  });

  it("emits no preview line for an unset priority that stays unset", () => {
    const resolution = resolvePreset({ priority: null }, issue({ triage: { priority: null } }));

    expect(resolution.changes).toEqual([]);
  });

  it("describes only the operations that change something", () => {
    const resolution = resolvePreset(
      { priority: 1, labels: { add: ["bug", "triage"] }, assignees: { add: ["jo"] } },
      issue({ labels: ["bug"] })
    );

    expect(describeResolution(resolution)).toBe("Set P1, Add triage, Assign jo");
  });

  it("describes an already-satisfied preset as a match", () => {
    const resolution = resolvePreset({ labels: { add: ["bug"] } }, issue({ labels: ["bug"] }));

    expect(describeResolution(resolution)).toBe("Already matches this preset");
  });
});

describe("invertResolution", () => {
  it("restores the previous priority", () => {
    const before = issue({ triage: { priority: 2 } });
    const resolution = resolvePreset({ priority: 1 }, before);

    expect(invertResolution(resolution, before)).toEqual({ priority: 2 });
  });

  it("removes only the labels the preset added", () => {
    const before = issue({ labels: ["documentation"] });
    const resolution = resolvePreset({ labels: { add: ["bug"] } }, before);

    expect(invertResolution(resolution, before)).toEqual({
      labels: { add: [], remove: ["bug"] },
    });
  });

  it("removes only the assignees the preset added", () => {
    const before = issue({ assignees: ["nadia"] });
    const resolution = resolvePreset({ assignees: { add: ["jo"] } }, before);

    expect(invertResolution(resolution, before)).toEqual({
      assignees: { add: [], remove: ["jo"] },
    });
  });

  it("produces an empty payload for a no-op resolution", () => {
    const before = issue({ labels: ["bug"] });
    const resolution = resolvePreset({ labels: { add: ["bug"] } }, before);

    expect(invertResolution(resolution, before)).toEqual({});
  });
});

describe("effectiveTriageState", () => {
  /**
   * @target effectiveTriageState
   * @dependencies PendingChanges
   * @scenario A batch repository has staged the removal of a label the cached
   *           issue row still carries
   * @expectedOutput The label is gone. Resolving a preset against the row alone
   *                 would report "bug" as already present, queue nothing, and let
   *                 the push remove the label the preset was asked to apply.
   */
  it("drops a label removed by a staged change", () => {
    const effective = effectiveTriageState(
      { labels: ["bug", "triage"], assignees: [] },
      { labels: { add: [], remove: ["bug"] } }
    );

    expect(effective.labels).toEqual(["triage"]);
  });

  it("keeps a label the staged change adds", () => {
    const effective = effectiveTriageState(
      { labels: ["bug"], assignees: [] },
      { labels: { add: ["confirmed"], remove: [] } }
    );

    expect(effective.labels).toEqual(["bug", "confirmed"]);
  });

  it("applies removals before additions so a staged replace wins", () => {
    const effective = effectiveTriageState(
      { labels: ["bug"], assignees: [] },
      { labels: { add: ["bug"], remove: ["bug"] } }
    );

    // mergePendingChanges never produces this shape; if it ever did, the
    // addition is the later intent and the label stays.
    expect(effective.labels).toEqual(["bug"]);
  });

  it("leaves the issue untouched when nothing is staged", () => {
    const effective = effectiveTriageState({ labels: ["bug"], assignees: ["jo"] }, null);

    expect(effective).toEqual({ labels: ["bug"], assignees: ["jo"] });
  });

  it("applies the same rule to assignees", () => {
    const effective = effectiveTriageState(
      { labels: [], assignees: ["jo", "nadia"] },
      { assignees: { add: ["sam"], remove: ["jo"] } }
    );

    expect(effective.assignees).toEqual(["nadia", "sam"]);
  });

  it("resolves a preset against the effective state, not the cached row", () => {
    const effective = effectiveTriageState(
      { labels: ["bug"], assignees: [] },
      { labels: { add: [], remove: ["bug"] } }
    );

    const resolution = resolvePreset({ labels: { add: ["bug"] } }, effective);

    expect(resolution.noChange).toBe(false);
    expect(resolution.payload.labels).toEqual({ add: ["bug"] });
  });
});

describe("invertToPayload", () => {
  const previous = { priority: null, labels: ["triage"], assignees: [] };

  /**
   * @target invertToPayload
   * @dependencies none
   * @scenario The preset adds a label that was already staged for removal
   * @expectedOutput The inverse still removes that label. The apply cancelled the
   *                 staged removal by adding it back, so undo must restore it —
   *                 and `previous` cannot, because the cached set never lost it.
   */
  it("should restore a staged removal the apply cancelled", () => {
    const inverse = invertToPayload(
      { payload: { labels: { add: ["bug"], remove: [] } }, changes: [], noChange: false },
      previous,
      { labels: { add: [], remove: ["bug"] } }
    );

    expect(inverse.labels).toEqual({ add: [], remove: ["bug"] });
  });

  /**
   * @target invertToPayload
   * @dependencies none
   * @scenario The label is in the cached set *and* staged for removal — the case
   *           that arises when a staged removal is cancelled by an apply
   * @expectedOutput The removal comes back. Without the staged diff this is the
   *                 case a naive inverse gets wrong: `previous.labels` already
   *                 contains the label, so it looks like nothing was added and
   *                 the removal is dropped, leaving the label on the issue.
   */
  it("should restore a staged removal of a label the cache still carries", () => {
    const inverse = invertToPayload(
      { payload: { labels: { add: ["bug"], remove: [] } }, changes: [], noChange: false },
      { priority: null, labels: ["bug", "triage"], assignees: [] },
      { labels: { add: ["bug"], remove: ["bug"] } }
    );

    expect(inverse.labels).toEqual({ add: [], remove: ["bug"] });
  });

  /**
   * @target invertToPayload, mergePendingChanges
   * @dependencies mergePendingChanges
   * @scenario Apply a preset that cancels a staged removal, then undo it
   * @expectedOutput The staged removal is back. `mergePendingChanges` cancels a
   *                 removal that matches a pending addition unless it is told the
   *                 label exists upstream — which is exactly this case, so the
   *                 undo alone was not enough and the label stayed at push.
   */
  it("should round-trip an undo back to the staged removal", () => {
    const before = { labels: { add: [] as string[], remove: ["bug"] } };
    const afterApply = mergePendingChanges(
      before,
      { labels: { add: ["bug"], remove: [] } },
      []
    );
    const inverse = invertToPayload(
      { payload: { labels: { add: ["bug"], remove: [] } }, changes: [], noChange: false },
      { priority: null, labels: ["bug", "triage"], assignees: [] },
      before
    );

    const afterUndo = mergePendingChanges(afterApply, inverse, ["bug", "triage"]);

    expect(afterUndo).toEqual({ labels: { add: [], remove: ["bug"] } });
  });

  /**
   * @target invertToPayload
   * @dependencies none
   * @scenario A live apply, so there is no staged diff
   * @expectedOutput Only the labels the apply actually added are removed.
   */
  it("should ignore staging when there was none", () => {
    const inverse = invertToPayload(
      { payload: { labels: { add: ["bug"], remove: [] } }, changes: [], noChange: false },
      previous,
      null
    );

    expect(inverse.labels).toEqual({ add: [], remove: ["bug"] });
  });
});
