/**
 * @module triage/components/assignee-picker
 * Command-palette dialog for searching, viewing, and toggling assignees on an issue.
 * Renders a searchable list of repository collaborators with avatar thumbnails
 * and check marks indicating who is currently assigned.
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
import { useRepoCollaborators } from "../use-repo-collaborators";
import { useTriageMutation } from "../use-triage-mutation";
import type { IssueWithTriage } from "@/features/inbox/use-issues";

/**
 * Props for the {@link AssigneePicker} component.
 *
 * @property open - Whether the command dialog is open.
 * @property onOpenChange - Callback to toggle the dialog open/closed.
 * @property issue - The issue whose assignees are being edited, or `null` if none.
 * @property batch - When `true`, stages the assignee change for batch push.
 */
interface AssigneePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  issue: IssueWithTriage | null;
  batch?: boolean;
}

/**
 * Searchable command dialog for toggling assignees on an issue.
 * Fetches collaborators from the repo and uses {@link useTriageMutation}
 * to assign or unassign users. Supports both live and batch modes.
 *
 * @param props - {@link AssigneePickerProps}
 * @returns The assignee picker dialog, or `null` if no issue is provided.
 */
export function AssigneePicker({ open, onOpenChange, issue, batch }: AssigneePickerProps) {
  const { data: collaborators, isLoading } = useRepoCollaborators(issue?.repoId);
  const triage = useTriageMutation();

  if (!issue) return null;

  const currentAssignees = new Set(issue.assignees);

  /**
   * Toggle an assignee on or off for the current issue.
   *
   * @param username - The username of the collaborator to toggle.
   */
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
