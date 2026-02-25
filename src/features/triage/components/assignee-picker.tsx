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
import { useRepoCollaborators } from "../use-repo-collaborators";
import { useTriageMutation } from "../use-triage-mutation";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

interface AssigneePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: IssueWithTriage | null;
  batch?: boolean;
}

export function AssigneePicker({ open, onOpenChange, issue, batch }: AssigneePickerProps) {
  const { data: collaborators, isLoading } = useRepoCollaborators(issue?.repoId);
  const triage = useTriageMutation();

  if (!issue) return null;

  const currentAssignees = new Set(issue.assignees);

  function toggleAssignee(username: string) {
    if (!issue) return;
    const isAssigned = currentAssignees.has(username);
    const payload = isAssigned
      ? { assignees: { add: [] as string[], remove: [username] } }
      : { assignees: { add: [username], remove: [] as string[] } };

    const previousPayload = isAssigned
      ? { assignees: { add: [username], remove: [] as string[] } }
      : { assignees: { add: [] as string[], remove: [username] } };

    triage.mutate({
      issueId: issue.id,
      payload,
      previousPayload,
      description: isAssigned ? `Unassigned ${username}` : `Assigned ${username}`,
      batch,
    });
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Assignees"
      description="Search and toggle assignees"
    >
      <CommandInput placeholder="Search collaborators..." />
      <CommandList>
        <CommandEmpty>
          {isLoading ? "Loading collaborators..." : "No collaborators found."}
        </CommandEmpty>
        <CommandGroup>
          {(collaborators ?? []).map((collab) => {
            const isAssigned = currentAssignees.has(collab.username);
            return (
              <CommandItem
                key={collab.username}
                value={collab.username}
                onSelect={() => toggleAssignee(collab.username)}
              >
                <div className="flex items-center gap-2 flex-1">
                  {collab.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={collab.avatar}
                      alt={collab.username}
                      className="h-5 w-5 rounded-full shrink-0"
                    />
                  ) : (
                    <span className="h-5 w-5 rounded-full bg-muted shrink-0" />
                  )}
                  <span>{collab.username}</span>
                </div>
                <Check
                  className={cn("h-4 w-4 shrink-0", isAssigned ? "opacity-100" : "opacity-0")}
                />
              </CommandItem>
            );
          })}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
