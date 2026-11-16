/**
 * @module presets/components/preset-editor
 *
 * The form that records a preset, and the form that reopens one.
 *
 * Two decisions shape it. First, nothing is pre-filled from the issue: a preset
 * is a decision the user is recording, so every value must be chosen here
 * rather than inherited from whatever happened to be selected when the dialog
 * opened. Second, every value is picked from the repository's own labels and
 * collaborators, so a stored bundle can only contain values the provider can
 * accept — the provider limits are read to explain a value that is near them,
 * not to police a free-text field.
 */
"use client";

import { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectField } from "@/components/select-field";
import { cn } from "@/lib/utils";
import { providerLimits } from "@/lib/provider-interface";
import { priorityOptions } from "@/features/triage/priority";
import { useRepoLabels } from "@/features/triage/use-repo-labels";
import { useRepoCollaborators } from "@/features/triage/use-repo-collaborators";
import type { IssueWithTriage } from "@/features/inbox/use-issues";
import { PRESET_NAME_LIMIT, type Preset, type PresetActions } from "@/features/presets/types";

/** The three states a stored priority can be in, as a select value. */
type PriorityChoice = "omit" | "clear" | "0" | "1" | "2" | "3";

/** How close to a limit a value has to be before its counter is worth showing. */
const COUNTER_MARGIN = 10;

/** The starting choice for a new preset, or the stored one when editing. */
function initialPriority(actions?: PresetActions): PriorityChoice {
  if (!actions || actions.priority === undefined) return "omit";
  if (actions.priority === null) return "clear";
  return String(actions.priority) as PriorityChoice;
}

/**
 * Assemble the bundle the API stores.
 *
 * @param choice - The priority select value.
 * @param labels - Selected label names.
 * @param assignees - Selected logins.
 * @returns The actions, with omitted fields left out entirely.
 */
function buildActions(
  choice: PriorityChoice,
  labels: string[],
  assignees: string[]
): PresetActions {
  const actions: PresetActions = {};
  if (choice === "clear") actions.priority = null;
  else if (choice !== "omit") actions.priority = Number(choice);
  if (labels.length > 0) actions.labels = { add: labels };
  if (assignees.length > 0) actions.assignees = { add: assignees };
  return actions;
}

interface PresetEditorProps {
  /** The issue whose repository the preset belongs to. */
  issue: IssueWithTriage;
  /** The preset being edited; omitted when creating a new one. */
  preset?: Preset;
  /** `true` while the create or update request is in flight. */
  saving: boolean;
  /** The server's rejection, shown inline as well as in the toast. */
  error?: string;
  /** Closes the editor without writing. */
  onCancel: () => void;
  /** Hands the assembled name and actions to the owning dialog. */
  onSave: (input: { name: string; actions: PresetActions }) => void;
}

/**
 * Name, priority, labels and assignees for one preset.
 *
 * @param props - {@link PresetEditorProps}
 */
export function PresetEditor({
  issue,
  preset,
  saving,
  error,
  onCancel,
  onSave,
}: PresetEditorProps) {
  const {
    data: repoLabels,
    isLoading: labelsLoading,
    isError: labelsError,
  } = useRepoLabels(issue.repoId);
  const {
    data: collaborators,
    isLoading: collaboratorsLoading,
    isError: collaboratorsError,
  } = useRepoCollaborators(issue.repoId);

  const [name, setName] = useState(preset?.name ?? "");
  const [priority, setPriority] = useState<PriorityChoice>(initialPriority(preset?.actions));
  const [labels, setLabels] = useState<string[]>(preset?.actions.labels?.add ?? []);
  const [assignees, setAssignees] = useState<string[]>(preset?.actions.assignees?.add ?? []);
  const [labelFilter, setLabelFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");

  // The provider decides how long a value may be; the client only explains it.
  const limits = providerLimits[issue.provider === "gitlab" ? "gitlab" : "github"];

  // A stored selection the repository no longer returns is kept in the list.
  // Dropping it would leave the value in the preset with no toggle to remove it,
  // so a label renamed upstream could be seen only by reading the saved bundle.
  const labelOptions = useMemo<
    Array<{ name: string; color: string | null; description: string | null; missing?: boolean }>
  >(() => {
    const known = new Set((repoLabels ?? []).map((label) => label.name));
    return [
      ...(repoLabels ?? []).map((label) => ({ ...label })),
      ...labels
        .filter((name) => !known.has(name))
        .map((name) => ({ name, color: null, description: null, missing: true })),
    ]
      .sort((a, b) => a.name.localeCompare(b.name))
      .filter((label) => label.name.toLowerCase().includes(labelFilter.trim().toLowerCase()));
  }, [repoLabels, labels, labelFilter]);

  const assigneeOptions = useMemo<
    Array<{
      username: string;
      avatar: string | null;
      permission: "admin" | "write" | "read";
      missing?: boolean;
    }>
  >(() => {
    const known = new Set((collaborators ?? []).map((person) => person.username));
    return [
      ...(collaborators ?? []).map((person) => ({ ...person })),
      ...assignees
        .filter((login) => !known.has(login))
        .map((login) => ({
          username: login,
          avatar: null,
          permission: "read" as const,
          missing: true,
        })),
    ]
      .sort((a, b) => a.username.localeCompare(b.username))
      .filter((person) =>
        person.username.toLowerCase().includes(assigneeFilter.trim().toLowerCase())
      );
  }, [collaborators, assignees, assigneeFilter]);

  const actions = buildActions(priority, labels, assignees);
  const hasActions = Object.keys(actions).length > 0;
  const trimmedName = name.trim();
  const canSave = trimmedName.length > 0 && hasActions && !saving;

  function toggleLabel(labelName: string) {
    setLabels((current) =>
      current.includes(labelName)
        ? current.filter((value) => value !== labelName)
        : [...current, labelName]
    );
  }

  function toggleAssignee(username: string) {
    setAssignees((current) =>
      current.includes(username)
        ? current.filter((value) => value !== username)
        : [...current, username]
    );
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    onSave({ name: trimmedName, actions });
  }

  return (
    <form onSubmit={handleSubmit} className="flex min-h-0 flex-col">
      <div className="shrink-0 border-b px-4 py-3">
        <label
          htmlFor="preset-name"
          className="mb-1.5 flex items-baseline justify-between gap-3 text-xs font-medium text-muted-foreground"
        >
          <span>Name</span>
          {name.length > PRESET_NAME_LIMIT - COUNTER_MARGIN && (
            <span
              className={cn(
                "font-mono tabular-nums",
                name.length >= PRESET_NAME_LIMIT ? "text-destructive" : "text-muted-foreground/70"
              )}
              aria-live="polite"
            >
              {name.length}/{PRESET_NAME_LIMIT}
            </span>
          )}
        </label>
        <Input
          id="preset-name"
          autoFocus
          value={name}
          maxLength={PRESET_NAME_LIMIT}
          onChange={(event) => setName(event.target.value)}
          placeholder="Confirmed bug"
          className="h-9"
        />
      </div>

      <div className="shrink-0 border-b px-4 py-3">
        <label
          htmlFor="preset-priority"
          className="mb-1.5 block text-xs font-medium text-muted-foreground"
        >
          Priority
        </label>
        <SelectField
          id="preset-priority"
          value={priority}
          onChange={(event) => setPriority(event.target.value as PriorityChoice)}
          className="w-full"
        >
          <option value="omit">Leave priority alone</option>
          <option value="clear">Clear priority</option>
          {priorityOptions.map((option) => (
            <option key={option.value} value={String(option.value)}>
              {option.name}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="border-b px-4 py-3" aria-labelledby="preset-labels-heading">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <h3 id="preset-labels-heading" className="text-xs font-medium text-muted-foreground">
              Labels
            </h3>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {labels.length} selected
            </span>
          </div>
          <Input
            value={labelFilter}
            onChange={(event) => setLabelFilter(event.target.value)}
            placeholder="Filter labels"
            aria-label="Filter labels"
            className="h-8 text-xs"
          />
          <ul className="mt-2 max-h-40 overflow-y-auto" aria-label="Repository labels">
            {labelsLoading && <li className="py-2 text-xs text-muted-foreground">Loading…</li>}
            {/* A failed fetch is not an empty repository. Reporting it as "no
                matches" gives the user nothing to act on and hides a provider
                problem behind their own search. */}
            {!labelsLoading && labelsError && (
              <li className="py-2 text-xs text-destructive">
                Could not load this repository&apos;s labels. Try again in a moment.
              </li>
            )}
            {!labelsLoading && !labelsError && labelOptions.length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">No labels match that filter.</li>
            )}
            {labelOptions.map((label) => {
              const selected = labels.includes(label.name);
              const nearLimit = label.name.length > limits.label - COUNTER_MARGIN;
              return (
                <li key={label.name}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleLabel(label.name)}
                    className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent aria-pressed:text-foreground"
                  >
                    {label.missing ? (
                      // Explained rather than hidden: the value is no longer on
                      // the repository, but it is still in this preset and the
                      // user needs a way to take it out.
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-destructive/40"
                      />
                    ) : label.color ? (
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: `#${label.color}` }}
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-muted"
                      />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono">{label.name}</span>
                    {nearLimit && (
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[11px] tabular-nums",
                          label.name.length >= limits.label
                            ? "text-destructive"
                            : "text-muted-foreground/70"
                        )}
                      >
                        {label.name.length}/{limits.label}
                      </span>
                    )}
                    <Check
                      aria-hidden="true"
                      className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="px-4 py-3" aria-labelledby="preset-assignees-heading">
          <div className="mb-1.5 flex items-baseline justify-between gap-3">
            <h3 id="preset-assignees-heading" className="text-xs font-medium text-muted-foreground">
              Assignees
            </h3>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {assignees.length} selected
            </span>
          </div>
          <Input
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            placeholder="Filter people"
            aria-label="Filter assignees"
            className="h-8 text-xs"
          />
          <ul className="mt-2 max-h-40 overflow-y-auto" aria-label="Repository collaborators">
            {collaboratorsLoading && (
              <li className="py-2 text-xs text-muted-foreground">Loading…</li>
            )}
            {!collaboratorsLoading && collaboratorsError && (
              <li className="py-2 text-xs text-destructive">
                Could not load this repository&apos;s collaborators. Try again in a moment.
              </li>
            )}
            {!collaboratorsLoading && !collaboratorsError && assigneeOptions.length === 0 && (
              <li className="py-2 text-xs text-muted-foreground">No collaborators match.</li>
            )}
            {assigneeOptions.map((person) => {
              const selected = assignees.includes(person.username);
              const nearLimit = person.username.length > limits.login - COUNTER_MARGIN;
              return (
                <li key={person.username}>
                  <button
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleAssignee(person.username)}
                    className="flex h-8 w-full min-w-0 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors hover:bg-accent"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{person.username}</span>
                    {nearLimit && (
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[11px] tabular-nums",
                          person.username.length >= limits.login
                            ? "text-destructive"
                            : "text-muted-foreground/70"
                        )}
                      >
                        {person.username.length}/{limits.login}
                      </span>
                    )}
                    <Check
                      aria-hidden="true"
                      className={cn("h-3.5 w-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")}
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      <div className="shrink-0 border-t px-4 py-3">
        {error && (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {error}
          </p>
        )}
        {!hasActions && (
          <p className="mb-2 text-xs text-muted-foreground">
            Pick at least one priority, label, or assignee to save.
          </p>
        )}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" className="h-9" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" size="sm" className="h-9" disabled={!canSave}>
            {preset ? "Save changes" : "Save preset"}
          </Button>
        </div>
      </div>
    </form>
  );
}
