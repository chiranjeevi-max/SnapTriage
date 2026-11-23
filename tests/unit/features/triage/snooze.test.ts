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
   * @scenario The clock is partway through a minute
   * @expectedOutput The next whole minute. The input's `min` is inclusive, so
   *                 the minute already in progress would be offered and then
   *                 refused by the future check, leaving Set disabled.
   */
  it("rounds the bound up past a partly elapsed minute", () => {
    const midMinute = new Date("2026-11-23T12:00:30.000Z");
    const bound = new Date(snoozeInputMin(midMinute));

    expect(bound.getTime()).toBeGreaterThan(midMinute.getTime());
    expect(bound.getSeconds()).toBe(0);
    expect(parseCustomSnooze(snoozeInputMin(midMinute), midMinute)).not.toBeNull();
  });

  /**
   * @target snoozeInputMin
   * @dependencies none
   * @scenario The clock sits exactly on a minute boundary
   * @expectedOutput The next minute, not the current one. `Math.ceil` does not
   *                 advance an exact value, so the inclusive `min` offered a
   *                 minute that is not in the future.
   */
  it("advances past a clock sitting on an exact minute", () => {
    const exact = new Date("2026-11-23T12:00:00.000Z");
    const bound = new Date(snoozeInputMin(exact));

    expect(bound.getTime()).toBe(exact.getTime() + 60_000);
  });

  /**
   * @target snoozeInputMin
   * @dependencies none
   * @scenario Any clock inside a minute
   * @expectedOutput Exactly the next whole minute, so the floor is never later
   *                 than it has to be and never earlier than it may be.
   */
  it("lands on exactly the next whole minute", () => {
    const midMinute = new Date("2026-11-23T12:00:30.000Z");

    expect(new Date(snoozeInputMin(midMinute)).getTime()).toBe(midMinute.getTime() + 30_000);
  });

  /**
   * @target snoozeInputMin
   * @dependencies none
   * @scenario Any clock, in whatever zone the suite happens to run
   * @expectedOutput A value `parseCustomSnooze` accepts.
   *
   * This is an invariant, not a DST reproduction. The repeated hour exists only
   * in some zones and CI runs in one without it, so these instants are ordinary
   * local times there. The property that must hold everywhere is that the bound
   * is always submittable, which is what this asserts; the DST behaviour was
   * verified by hand against America/New_York, where the old code rendered a wall
   * clock that parsed back an hour into the past.
   */
  it("always returns a submittable bound", () => {
    for (const now of [
      new Date("2026-11-01T05:30:00Z"),
      new Date("2026-11-01T06:00:00Z"),
      new Date("2026-03-29T01:30:00Z"),
      new Date("2026-06-15T12:00:00Z"),
    ]) {
      const value = snoozeInputMin(now);
      expect(
        parseCustomSnooze(value, now),
        `bound ${value} at ${now.toISOString()}`
      ).not.toBeNull();
    }
  });

  /**
   * @target snoozeInputMin
   * @dependencies none
   * @scenario The bound is rendered for a `datetime-local` input
   * @expectedOutput The next minute in local time, in the input's own shape.
   *                 Formatting in UTC would shift the floor by the zone offset,
   *                 so the browser would offer an instant the check rejects.
   */
  it("formats the next minute in local time", () => {
    const value = snoozeInputMin(NOW);

    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

    // NOW is 12:00:00 exactly, so the bound is 12:01 local.
    const nextMinute = new Date(NOW.getTime() + 60_000);
    const expected = new Date(nextMinute.getTime() - nextMinute.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    expect(value).toBe(expected);
  });
});
