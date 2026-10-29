/**
 * @module triage/components/label-picker
 * Command-palette dialog for searching, viewing, and toggling labels on an issue.
 * Renders a searchable list of all labels available on the issue's repository,
 * with check marks indicating which labels are currently applied.
 */
"use client";

import { Check } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useRepoLabels } from "@/features/triage/use-repo-labels";
import { useTriageMutation } from "@/features/triage/use-triage-mutation";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

/**
 * Props for the {@link LabelPicker} component.
 *
 * @property open - Whether the command dialog is open.
 * @property onOpenChange - Callback to toggle the dialog open/closed.
 * @property issue - The issue whose labels are being edited, or `null` if none.
 * @property batch - When `true`, stages the label change for batch push.
 */
interface LabelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: IssueWithTriage | null;
  batch?: boolean;
}

/**
 * Searchable command dialog for toggling labels on an issue.
 * Fetches available labels from the repo and uses {@link useTriageMutation}
 * to apply or remove labels. Supports both live and batch modes.
 *
 * @param props - {@link LabelPickerProps}
 * @returns The label picker dialog, or `null` if no issue is provided.
 */
export function LabelPicker({ open, onOpenChange, issue, batch }: LabelPickerProps) {
  const { data: labels, isLoading } = useRepoLabels(issue?.repoId);
  const triage = useTriageMutation();

  if (!issue) return null;

  const currentLabels = new Set(issue.labels);

  /**
   * Toggle a label on or off for the current issue.
   *
   * @param labelName - The name of the label to toggle.
   */
  function toggleLabel(labelName: string) {
    if (!issue) return;
    const isApplied = currentLabels.has(labelName);
    const payload = isApplied
      ? { labels: { add: [] as string[], remove: [labelName] } }
      : { labels: { add: [labelName], remove: [] as string[] } };

    const previousPayload = isApplied
      ? { labels: { add: [labelName], remove: [] as string[] } }
      : { labels: { add: [] as string[], remove: [labelName] } };

    triage.mutate({
      issueId: issue.id,
      payload,
      previousPayload,
      description: isApplied ? `Removed label "${labelName}"` : `Added label "${labelName}"`,
      batch,
    });
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Labels"
      description="Search and toggle labels"
      className="flex max-h-[calc(100dvh-2rem)] flex-col [&_[data-slot=command]]:min-h-0"
    >
      <CommandInput placeholder="Search labels..." className="min-w-0 pr-10" />
      <CommandList className="min-h-0 max-h-[min(20rem,60dvh)] flex-1">
        <CommandEmpty className="py-6 text-xs text-muted-foreground">
          {isLoading ? "Loading labels..." : "No labels found."}
        </CommandEmpty>
        <CommandGroup>
          {(labels ?? []).map((label) => {
            const isApplied = currentLabels.has(label.name);
            return (
              <CommandItem
                key={label.name}
                value={label.name}
                onSelect={() => toggleLabel(label.name)}
                className="min-h-11 gap-3"
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  {label.color && (
                    <span
                      className="mt-1 h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: `#${label.color}` }}
                    />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="break-words [overflow-wrap:anywhere]">{label.name}</span>
                    {label.description && (
                      <span className="line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                        {label.description}
                      </span>
                    )}
                  </div>
                </div>
                <Check
                  className={cn("h-4 w-4 shrink-0", isApplied ? "opacity-100" : "opacity-0")}
                />
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
