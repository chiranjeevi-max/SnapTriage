/**
 * @module tests/unit/features/triage/snooze
 *
 * A snooze is stored as an instant and read back as "is it still in the future".
 * Anything that is not a future instant therefore stores a snooze that has
 * already expired, which the inbox renders as not snoozed — so the input has to
 * be refused rather than converted.
 */
import { describe, it, expect } from "vitest";
import { getSnoozeOptions, parseCustomSnooze, snoozeInputMin } from "@/features/triage/snooze";

const NOW = new Date("2026-11-23T12:00:00.000Z");

describe("getSnoozeOptions", () => {
  /**
   * @target getSnoozeOptions
   * @dependencies none
   * @scenario The picker opens at a known instant
   * @expectedOutput Presets in display order, each strictly in the future
   */
  it("offers presets that all lie in the future", () => {
    const options = getSnoozeOptions(NOW);

    expect(options.map((option) => option.label)).toEqual([
      "1 hour",
      "Tomorrow 9am",
      "Next Monday 9am",
    ]);
    for (const option of options) {
      expect(new Date(option.value).getTime()).toBeGreaterThan(NOW.getTime());
    }
  });

  /**
   * @target getSnoozeOptions
   * @dependencies none
   * @scenario The 1-hour preset
   * @expectedOutput Exactly one hour after the supplied instant
   */
  it("measures the hour preset from the given instant", () => {
    const [oneHour] = getSnoozeOptions(NOW);

    expect(new Date(oneHour.value).getTime()).toBe(NOW.getTime() + 60 * 60 * 1000);
  });

  /**
   * @target getSnoozeOptions
   * @dependencies none
   * @scenario Every day of the week, including Sunday
   * @expectedOutput "Next Monday" is always a future Monday. On a Sunday the
   *                 day-name arithmetic has to land on tomorrow rather than
   *                 today, which the `|| 7` fallback is for.
   */
  it("always targets a future Monday", () => {
    for (let day = 0; day < 7; day++) {
      const now = new Date("2026-11-23T12:00:00.000Z");
      now.setDate(now.getDate() + day);

      const monday = new Date(getSnoozeOptions(now)[2].value);

      expect(monday.getTime()).toBeGreaterThan(now.getTime());
      expect(monday.getDay()).toBe(1);
    }
  });
});

describe("parseCustomSnooze", () => {
  /**
   * @target parseCustomSnooze
   * @dependencies none
   * @scenario A well-formed future value from a datetime-local input
   * @expectedOutput Its ISO instant
   */
  it("accepts a future instant", () => {
    const iso = parseCustomSnooze("2026-12-01T09:00", NOW);

    expect(iso).toBe(new Date("2026-12-01T09:00").toISOString());
  });

  /**
   * @target parseCustomSnooze
   * @dependencies none
   * @scenario The value cannot be parsed
   * @expectedOutput `null` rather than throwing. `new Date(...).toISOString()`
   *                 threw a RangeError inside the click handler, which React
   *                 surfaced as a crashed dialog.
   */
  it("refuses an unparseable value instead of throwing", () => {
    expect(parseCustomSnooze("not-a-date", NOW)).toBeNull();
    expect(parseCustomSnooze("2026-13-45T99:99", NOW)).toBeNull();
  });

  /**
   * @target parseCustomSnooze
   * @dependencies none
   * @scenario The value is in the past
   * @expectedOutput `null`: the stored snooze would already have expired, so
   *                 the issue would read as not snoozed the moment it was set.
   */
  it("refuses an instant that has already passed", () => {
    expect(parseCustomSnooze("2026-11-01T09:00", NOW)).toBeNull();
  });

  /**
   * @target parseCustomSnooze
   * @dependencies none
   * @scenario The input is empty
   * @expectedOutput `null`, the same as no selection.
   */
  it("treats an empty value as no selection", () => {
    expect(parseCustomSnooze("", NOW)).toBeNull();
  });
});

describe("snoozeInputMin", () => {
  /**
   * @target snoozeInputMin
   * @dependencies none
   * @scenario A `datetime-local` input needs a floor
   * @expectedOutput The current local time in the input's own shape, so the
   *                 browser offers no past instant. Formatting in UTC would
   *                 shift the floor by the zone offset.
   */
  it("formats the bound in local time", () => {
    const value = snoozeInputMin(NOW);

    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(value).toBe(
      new Date(NOW.getTime() - NOW.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
    );
    // Feeding it back as a local value must land on the same minute.
    expect(new Date(value).getMinutes()).toBe(NOW.getMinutes());
  });
});
