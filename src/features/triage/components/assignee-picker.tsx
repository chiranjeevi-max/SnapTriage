/**
 * @module triage/components/assignee-picker
 * Command-palette dialog for searching, viewing, and toggling assignees on an issue.
 * Renders a searchable list of repository collaborators with avatar thumbnails
 * and check marks indicating who is currently assigned.
 */
"use client";

import { useMemo } from "react";
import Image from "next/image";
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
import { useRepoCollaborators } from "@/features/triage/use-repo-collaborators";
import { useTriageMutation } from "@/features/triage/use-triage-mutation";
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
  const { data: collaborators, isLoading, isError } = useRepoCollaborators(issue?.repoId);
  const triage = useTriageMutation();

  /**
   * The repository's collaborators, plus anyone already assigned.
   *
   * The listing can be unavailable, and the listing budget can stop before every
   * collaborator. Somebody already on the issue must stay manageable, so those
   * logins are merged in.
   *
   * Above the early return so the hook order is stable.
   */
  const options = useMemo(() => {
    const listed = collaborators ?? [];
    const issueAssignees = issue?.assignees ?? [];
    const missing = issueAssignees.filter(
      (login) => !listed.some((collab) => collab.username.toLowerCase() === login.toLowerCase())
    );
    return [
      ...listed,
      ...missing.map((username) => ({ username, avatar: null, permission: "read" as const })),
    ];
  }, [collaborators, issue?.assignees]);

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
      className="flex max-h-[calc(100dvh-2rem)] flex-col [&_[data-slot=command]]:min-h-0"
    >
      <CommandInput placeholder="Search collaborators..." className="min-w-0 pr-10" />
      <CommandList className="min-h-0 max-h-[min(20rem,60dvh)] flex-1">
        <CommandEmpty className="py-6 text-xs text-muted-foreground">
          {isLoading
            ? "Loading collaborators..."
            : isError
              ? "Could not load collaborators. Try again in a moment."
              : "No collaborators found."}
        </CommandEmpty>
        <CommandGroup>
          {options.map((collab) => {
            const isAssigned = currentAssignees.has(collab.username);
            return (
              <CommandItem
                key={collab.username}
                value={collab.username}
                onSelect={() => toggleAssignee(collab.username)}
                className="min-h-11 gap-3"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {collab.avatar ? (
                    <Image
                      src={collab.avatar}
                      alt={collab.username}
                      width={20}
                      height={20}
                      className="h-5 w-5 shrink-0 rounded-full"
                      unoptimized
                    />
                  ) : (
                    <span className="h-5 w-5 shrink-0 rounded-full bg-muted" />
                  )}
                  <span className="min-w-0 flex-1 break-all">{collab.username}</span>
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
