/**
 * @module tests/unit/features/triage/priority
 *
 * Unit tests for the shared priority metadata.
 *
 * The priority colours and key hints are shown in the inbox, the issue
 * detail, the bulk bar, and the landing page demo, so they have to stay in
 * step with the shortcut registry.
 */
import { describe, it, expect } from "vitest";
import { priorityLabels, priorityOptions } from "@/features/triage/priority";
import { shortcuts } from "@/features/keyboard/shortcut-registry";

describe("priority metadata", () => {
  it("lists P0 through P3 in order", () => {
    expect(priorityOptions.map((option) => option.label)).toEqual(["P0", "P1", "P2", "P3"]);
  });

  it("gives every priority a distinct colour treatment", () => {
    const classes = priorityOptions.map((option) => option.className);
    expect(new Set(classes).size).toBe(classes.length);
  });

  it("keeps the key hints in step with the shortcut registry", () => {
    for (const option of priorityOptions) {
      const shortcut = shortcuts.find((entry) => entry.id === `priority-${option.value}`);
      expect(shortcut, `missing shortcut for priority ${option.value}`).toBeDefined();
      expect(option.key).toBe(shortcut!.key);
    }
  });

  it("names every priority in the lookup", () => {
    expect(priorityLabels[0].name).toBe("P0 Critical");
    expect(priorityLabels[3].name).toBe("P3 Low");
  });
});
