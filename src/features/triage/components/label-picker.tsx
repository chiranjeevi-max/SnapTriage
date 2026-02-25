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
import { useRepoLabels } from "../use-repo-labels";
import { useTriageMutation } from "../use-triage-mutation";
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
    >
      <CommandInput placeholder="Search labels..." />
      <CommandList>
        <CommandEmpty>{isLoading ? "Loading labels..." : "No labels found."}</CommandEmpty>
        <CommandGroup>
          {(labels ?? []).map((label) => {
            const isApplied = currentLabels.has(label.name);
            return (
              <CommandItem
                key={label.name}
                value={label.name}
                onSelect={() => toggleLabel(label.name)}
              >
                <div className="flex items-center gap-2 flex-1">
                  {label.color && (
                    <span
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: `#${label.color}` }}
                    />
                  )}
                  <span>{label.name}</span>
                  {label.description && (
                    <span className="text-xs text-muted-foreground truncate">
                      {label.description}
                    </span>
                  )}
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
