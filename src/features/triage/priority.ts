/**
 * @module triage/priority
 *
 * Display metadata for triage priorities.
 *
 * Shared by the inbox list, the issue detail, the bulk action bar, and the
 * landing page demo so every surface speaks the same colour language. The
 * light-theme values are darker than the dark-theme ones because a 400-weight
 * tint on a pale surface does not hold its contrast.
 */

/** One priority level and everything needed to display it. */
export interface PriorityOption {
  /** Priority value, `0` (P0) through `3` (P3). */
  value: number;
  /** Short badge text, e.g. "P1". */
  label: string;
  /** Full name, e.g. "P1 High". */
  name: string;
  /** Tailwind classes for the priority badge. */
  className: string;
  /** Key that sets this priority. */
  key: string;
}

/** Priority metadata, keyed by priority number. */
export const priorityLabels: Record<number, PriorityOption> = {
  0: {
    value: 0,
    label: "P0",
    name: "P0 Critical",
    className: "border-red-500/30 bg-red-500/10 text-red-700 dark:bg-red-500/20 dark:text-red-400",
    key: "1",
  },
  1: {
    value: 1,
    label: "P1",
    name: "P1 High",
    className:
      "border-orange-500/30 bg-orange-500/10 text-orange-700 dark:bg-orange-500/20 dark:text-orange-400",
    key: "2",
  },
  2: {
    value: 2,
    label: "P2",
    name: "P2 Medium",
    className:
      "border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-400",
    key: "3",
  },
  3: {
    value: 3,
    label: "P3",
    name: "P3 Low",
    className:
      "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400",
    key: "4",
  },
};

/** Priority options in display order, P0 first. */
export const priorityOptions: PriorityOption[] = [0, 1, 2, 3].map((value) => priorityLabels[value]);
