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

interface LabelPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: IssueWithTriage | null;
  batch?: boolean;
}

export function LabelPicker({ open, onOpenChange, issue, batch }: LabelPickerProps) {
  const { data: labels, isLoading } = useRepoLabels(issue?.repoId);
  const triage = useTriageMutation();

  if (!issue) return null;

  const currentLabels = new Set(issue.labels);

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
