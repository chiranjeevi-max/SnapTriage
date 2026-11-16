/**
 * @module presets/components/preset-diff
 *
 * The resolved change set, rendered as the user reads it.
 *
 * One rule drives the whole component: nothing the resolver reported may be
 * hidden. A value the issue already carries is shown with `=` and de-emphasised
 * rather than dropped, because it is the evidence that the preset considered
 * that value and found it already true. Hiding it would make an "apply" that
 * adds one of five labels look arbitrary.
 */
"use client";

import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PreviewChange } from "@/features/presets/types";

/** The three preview groups, in the resolver's display order. */
const GROUP_ORDER: ReadonlyArray<{ kind: PreviewChange["kind"]; title: string }> = [
  { kind: "priority", title: "Priority" },
  { kind: "label", title: "Labels" },
  { kind: "assignee", title: "Assignees" },
];

/** The sentence a screen reader gets for one change, since the glyph is decorative. */
function accessibleLabel(change: PreviewChange): string {
  if (change.operation === "=") {
    if (change.kind === "priority") return `Priority already ${change.value}`;
    if (change.kind === "label") return `Already has label ${change.value}`;
    return `Already assigned to ${change.value}`;
  }
  if (change.operation === "-") return `Clear priority, currently ${change.value}`;
  if (change.kind === "priority") return `Set priority to ${change.value}`;
  if (change.kind === "label") return `Add label ${change.value}`;
  return `Assign ${change.value}`;
}

/** One preview row: operator, value, and the de-emphasis that `=` earns. */
function DiffRow({ change }: { change: PreviewChange }) {
  const unchanged = change.operation === "=";
  return (
    <li
      className={cn(
        "flex min-w-0 items-baseline gap-2 text-xs transition-colors",
        unchanged ? "text-muted-foreground/60" : "text-foreground"
      )}
      aria-label={accessibleLabel(change)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "w-3 shrink-0 text-center font-mono",
          unchanged ? "text-muted-foreground/50" : "text-foreground"
        )}
      >
        {change.operation}
      </span>
      <span aria-hidden="true" className="min-w-0 break-all font-mono">
        {change.value}
      </span>
    </li>
  );
}

interface PresetDiffProps {
  /** The preview lines from {@link resolvePreset}, or the server's echo of them. */
  changes: PreviewChange[];
  /** Extra classes for the wrapper. */
  className?: string;
}

/**
 * Renders every reported change, grouped by kind, in the resolver's order.
 *
 * @param props - {@link PresetDiffProps}
 */
export function PresetDiff({ changes, className }: PresetDiffProps) {
  if (changes.length === 0) {
    return (
      <p className={cn("text-xs leading-relaxed text-muted-foreground", className)}>
        This preset has nothing to change on this issue.
      </p>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {GROUP_ORDER.map(({ kind, title }) => {
        const group = changes.filter((change) => change.kind === kind);
        if (group.length === 0) return null;
        return (
          <div key={kind} className="min-w-0">
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {title}
            </p>
            <ul className="flex flex-col gap-1">
              {group.map((change, index) => (
                <DiffRow key={`${change.value}-${change.operation}-${index}`} change={change} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The count line under the diff: how many additions, how many already true.
 *
 * @param props - `changes` from {@link resolvePreset}.
 */
export function PresetDiffSummary({ changes }: { changes: PreviewChange[] }) {
  const added = changes.filter((change) => change.operation === "+").length;
  const cleared = changes.filter((change) => change.operation === "-").length;
  const same = changes.filter((change) => change.operation === "=").length;
  const changing = added + cleared;

  const parts: string[] = [];
  if (changing > 0) parts.push(`${changing} change${changing === 1 ? "" : "s"}`);
  if (same > 0) parts.push(`${same} already in place`);

  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {changing > 0 ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      <span>{parts.length > 0 ? parts.join(" · ") : "No changes"}</span>
    </p>
  );
}
