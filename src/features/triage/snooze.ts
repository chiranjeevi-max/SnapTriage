/**
 * @module triage/snooze
 *
 * Resolving a snooze target instant.
 *
 * Kept out of the picker so the rules can be tested without rendering React: a
 * snooze is only meaningful if the date parses and the instant is in the future,
 * and `new Date(...).toISOString()` throws inside a click handler on the first
 * check while silently behaving as no snooze on the second.
 */

/** One preset snooze duration offered by the picker. */
export interface SnoozeOption {
  label: string;
  /** ISO 8601 instant the issue is snoozed until. */
  value: string;
}

/**
 * Compute the preset snooze targets relative to a given instant.
 *
 * @param now - The instant the picker was opened. Injected so the presets are
 *              testable without freezing the clock.
 * @returns The presets in display order.
 */
export function getSnoozeOptions(now: Date): SnoozeOption[] {
  const oneHour = new Date(now.getTime() + 60 * 60 * 1000);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const nextMonday = new Date(now);
  // Sunday is 0, so this is the days until the *next* Monday, never today.
  const daysUntilMonday = (8 - now.getDay()) % 7 || 7;
  nextMonday.setDate(nextMonday.getDate() + daysUntilMonday);
  nextMonday.setHours(9, 0, 0, 0);

  return [
    { label: "1 hour", value: oneHour.toISOString() },
    { label: "Tomorrow 9am", value: tomorrow.toISOString() },
    { label: "Next Monday 9am", value: nextMonday.toISOString() },
  ];
}

/**
 * Turn a `datetime-local` value into a snooze instant.
 *
 * @param value - The input's value, e.g. `"2026-11-25T09:00"`, read as local time.
 * @param now - The instant to judge "future" against.
 * @returns The ISO instant, or `null` when the value is empty, unparseable, or
 *          not in the future. A past instant stores a snooze that has already
 *          expired, which the inbox then reads as not snoozed at all.
 */
export function parseCustomSnooze(value: string, now: Date): string | null {
  if (!value) return null;

  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return null;
  if (target.getTime() <= now.getTime()) return null;

  return target.toISOString();
}

/**
 * The `min` a `datetime-local` input needs so the browser offers no past
 * instant, in that input's own `YYYY-MM-DDTHH:mm` shape and local time.
 *
 * @param now - The instant to bound from.
 * @returns The minimum selectable value.
 */
export function snoozeInputMin(now: Date): string {
  // Formatted from the generated instant's own local fields rather than by
  // applying `now`'s offset to it: during the repeated hour when clocks fall back
  // the two offsets differ, and reusing `now`'s rendered a wall clock an hour away
  // from the instant it meant.
  const format = (at: Date) => {
    const pad = (value: number) => String(value).padStart(2, "0");
    return (
      `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}` +
      `T${pad(at.getHours())}:${pad(at.getMinutes())}`
    );
  };

  // Walk forward a minute at a time until the value round-trips to an instant in
  // the future. `datetime-local` carries no zone, so a wall clock inside the
  // repeated hour resolves to the earlier occurrence and reads as already past;
  // no string can disambiguate it, so the bound steps past the ambiguity instead
  // of offering a value the submit check then refuses.
  let candidate = (Math.floor(now.getTime() / 60_000) + 1) * 60_000;
  for (let step = 0; step < 120; step++) {
    const value = format(new Date(candidate));
    if (parseCustomSnooze(value, now)) return value;
    candidate += 60_000;
  }

  // Two hours of steps always clears a one-hour transition.
  return format(new Date(candidate));
}
