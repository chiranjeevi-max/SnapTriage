/**
 * @module presets/components/preset-picker
 *
 * The preset pane: pick one, read what it would do, then decide.
 *
 * The pane never applies a preset the user has not seen resolved against this
 * issue. Selecting a row swaps the list for a preview built by
 * {@link resolvePreset} — the same function the server applies with — so the
 * diff on screen is the diff that will be written. Values the issue already
 * carries stay visible in that diff, de-emphasised: they are the evidence that
 * the preset was considered, and they are what makes an "apply" that adds one
 * of five labels legible instead of arbitrary.
 *
 * Creating, renaming, and deleting live in the same dialog because they answer
 * the same question, and the panel state lives in the body rather than the
 * dialog so closing the dialog discards it: a preview left over from the last
 * issue would read as a resolution of the newly selected one.
 */
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { IssueWithTriage } from "@/features/inbox/use-issues";
import { describeActions, hasPresetActions } from "@/features/presets/preset-actions";
import {
  describeResolution,
  effectiveTriageState,
  resolvePreset,
  PRESET_LIMIT_PER_REPO,
  type Preset,
  type PresetActions,
  type PresetResolution,
} from "@/features/presets/types";
import {
  useCreatePreset,
  useDeletePreset,
  usePresets,
  useRepoBatchMode,
  useUpdatePreset,
} from "@/features/presets/use-presets";
import { useApplyPreset } from "@/features/presets/use-apply-preset";
import { PresetDiff, PresetDiffSummary } from "./preset-diff";
import { PresetEditor } from "./preset-editor";

/** Which panel the dialog is showing. */
type Mode = "browse" | "preview" | "create" | "edit" | "delete";

/**
 * A panel that owns Enter.
 *
 * cmdk's root listener calls `preventDefault` on every Enter so it can select
 * the highlighted item. In the preview, editor, and confirmation panels there
 * are no command items to select, and the default that gets swallowed is the
 * one that presses the focused button. Stopping the event here leaves the
 * browser's own activation alone while the browse panel keeps its behaviour.
 */
function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (event.key === "Enter") event.stopPropagation();
      }}
    >
      {children}
    </div>
  );
}

interface PresetPickerBodyProps {
  /** The issue the preset would be applied to. */
  issue: IssueWithTriage;
  /** `true` when the button should read "Stage preset". */
  stageMode: boolean;
  /** Closes the dialog after a successful apply. */
  onApplied: () => void;
}

/** The contents of the dialog: list, preview, editor, and delete confirmation. */
function PresetPickerBody({ issue, stageMode, onApplied }: PresetPickerBodyProps) {
  const { data: presets, isLoading, isError: presetsError } = usePresets(issue.repoId);
  const createPreset = useCreatePreset(issue.repoId);
  const updatePreset = useUpdatePreset(issue.repoId);
  const deletePreset = useDeletePreset(issue.repoId);
  const applyPreset = useApplyPreset();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<Mode>("browse");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A stored bundle with nothing in it cannot do anything, so it is not offered.
  const visiblePresets = useMemo(
    () => (presets ?? []).filter((preset) => hasPresetActions(preset.actions)),
    [presets]
  );

  const selected = useMemo(
    () => visiblePresets.find((preset) => preset.id === selectedId) ?? null,
    [visiblePresets, selectedId]
  );

  const resolution: PresetResolution | null = useMemo(
    () =>
      selected
        ? resolvePreset(
            selected.actions,
            // Resolve against what the push will produce in batch mode, so the
            // preview matches the diff the server computes. A staged removal of a
            // label the preset adds would otherwise read as a no-op here too.
            { ...issue, ...effectiveTriageState(issue, issue.triage?.pendingChanges) }
          )
        : null,
    [selected, issue]
  );

  function backToBrowse() {
    // Clear mutation errors on the way out. The editor shows the previous
    // failure when it reopens otherwise, which reads as if the new attempt had
    // already failed before anything was typed.
    createPreset.reset();
    updatePreset.reset();
    setMode("browse");
    setSelectedId(null);
  }

  function handleSave(input: { name: string; actions: PresetActions }) {
    if (mode === "edit" && selected) {
      updatePreset.mutate(
        { id: selected.id, name: input.name, actions: input.actions },
        {
          onSuccess: (updated) => {
            // Seed the cache before switching to preview. The invalidation the
            // hook starts is asynchronous, so `selected` would otherwise still
            // hold the pre-edit actions and Apply could show one bundle while the
            // server applies another.
            queryClient.setQueryData<Preset[]>(
              ["presets", issue.repoId],
              (current) =>
                current?.map((preset) => (preset.id === updated.id ? updated : preset)) ?? [updated]
            );
            setMode("preview");
          },
        }
      );
      return;
    }
    createPreset.mutate(input, {
      onSuccess: (created) => {
        setSelectedId(created.id);
        // Straight into the preview built from what was just saved. The list is
        // refetched in the background, and waiting for it would show the
        // pre-edit bundle for a moment if it were used instead.
        setMode("preview");
      },
    });
  }

  function handleApply() {
    if (!selected || !resolution) return;
    applyPreset.mutate(
      {
        issueId: issue.id,
        presetId: selected.id,
        presetName: selected.name,
        preview: resolution,
        batch: stageMode,
      },
      { onSuccess: onApplied }
    );
  }

  return (
    <>
      {mode === "browse" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <CommandInput placeholder="Search presets..." className="min-w-0 pr-10" />
          <CommandList className="min-h-0 max-h-[min(24rem,60dvh)] flex-1">
            <CommandEmpty className="px-4 py-6">
              <p className="text-sm font-medium">
                {isLoading
                  ? "Loading presets…"
                  : presetsError
                    ? "Could not load presets"
                    : visiblePresets.length > 0
                      ? "No preset matches that search"
                      : "No presets yet"}
              </p>
              {/* A failed load is not an empty repository, and offering "Create
                  preset" here would suggest the user has none when the truth is
                  that none could be read. */}
              {!isLoading && presetsError && (
                <p className="mx-auto mt-1.5 max-w-[38ch] text-xs leading-relaxed text-destructive">
                  The presets for this repository could not be read. Close the pane and try again.
                </p>
              )}
              {!isLoading &&
                !presetsError &&
                (visiblePresets.length > 0 ? (
                  <p className="mx-auto mt-1.5 max-w-[38ch] text-xs leading-relaxed text-muted-foreground">
                    Clear the search to see every preset in this repository.
                  </p>
                ) : (
                  <>
                    <p className="mx-auto mt-1.5 max-w-[38ch] text-xs leading-relaxed text-muted-foreground">
                      A preset records the labels, assignees, and priority you reach for whenever
                      the same kind of issue arrives.
                    </p>
                    <Button
                      size="sm"
                      className="mt-4 h-9"
                      onClick={() => setMode("create")}
                      onKeyDown={(event) => {
                        // cmdk's root always handles Enter to select an item, and
                        // this button lives outside the list, so without this the
                        // empty-state action is unreachable by keyboard.
                        if (event.key === "Enter") event.stopPropagation();
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Create preset
                    </Button>
                  </>
                ))}
            </CommandEmpty>
            {visiblePresets.length > 0 && (
              <CommandGroup heading="Presets">
                {visiblePresets.map((preset) => (
                  <CommandItem
                    key={preset.id}
                    value={`${preset.name} ${describeActions(preset.actions)}`}
                    onSelect={() => {
                      setSelectedId(preset.id);
                      setMode("preview");
                    }}
                    className="min-h-11 items-start gap-3"
                  >
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="break-words text-sm [overflow-wrap:anywhere]">
                        {preset.name}
                      </span>
                      <span className="break-words font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {describeActions(preset.actions)}
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {visiblePresets.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem value="create a new preset" onSelect={() => setMode("create")}>
                    <Plus className="h-3.5 w-3.5" />
                    Create preset
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
          <div className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2">
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {visiblePresets.length}/{PRESET_LIMIT_PER_REPO}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setMode("create")}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.stopPropagation();
              }}
            >
              <Plus className="h-3 w-3" />
              New preset
            </Button>
          </div>
        </div>
      )}

      {mode === "preview" && selected && resolution && (
        <Panel>
          <div className="flex shrink-0 items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                {selected.name}
              </p>
              <p className="mt-0.5 break-words font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {describeActions(selected.actions)}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  updatePreset.reset();
                  setMode("edit");
                }}
                aria-label={`Rename ${selected.name}`}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  deletePreset.reset();
                  setMode("delete");
                }}
                aria-label={`Delete ${selected.name}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <Separator />

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <p
              className={cn(
                "mb-2 text-xs font-medium",
                resolution.noChange ? "text-muted-foreground" : "text-foreground"
              )}
            >
              {resolution.noChange ? "Already applied" : describeResolution(resolution)}
            </p>
            <PresetDiff changes={resolution.changes} />
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {resolution.noChange
                ? "Nothing here would change: every value is already on this issue, so nothing is written and there is nothing to undo."
                : "Values marked = are already on the issue and stay untouched."}
            </p>
          </div>

          <div className="shrink-0 border-t px-4 py-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <PresetDiffSummary changes={resolution.changes} />
              {resolution.noChange && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Check className="h-3 w-3" />
                  Nothing to do
                </Badge>
              )}
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-9" onClick={backToBrowse}>
                Back
              </Button>
              <Button
                size="sm"
                className="h-9"
                disabled={resolution.noChange || applyPreset.isPending}
                onClick={handleApply}
              >
                {stageMode ? "Stage preset" : "Apply preset"}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {(mode === "create" || mode === "edit") && (
        <Panel>
          <PresetEditor
            issue={issue}
            preset={mode === "edit" ? (selected ?? undefined) : undefined}
            saving={mode === "edit" ? updatePreset.isPending : createPreset.isPending}
            error={mode === "edit" ? updatePreset.error?.message : createPreset.error?.message}
            onCancel={() => (mode === "edit" ? setMode("preview") : backToBrowse())}
            onSave={handleSave}
          />
        </Panel>
      )}

      {mode === "delete" && selected && (
        <Panel>
          <div className="flex flex-col px-4 py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Delete this preset?</p>
                <p className="mt-1 break-words text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                  “{selected.name}” will be removed from this repository. Issues it was already
                  applied to keep the labels, assignees, and priority it gave them — deleting a
                  preset does not undo earlier applications.
                </p>
              </div>
            </div>
            {deletePreset.error && (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {deletePreset.error.message}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" className="h-9" onClick={() => setMode("preview")}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                className="h-9"
                disabled={deletePreset.isPending}
                onClick={() =>
                  deletePreset.mutate({ id: selected.id }, { onSuccess: backToBrowse })
                }
              >
                Delete
              </Button>
            </div>
          </div>
        </Panel>
      )}
    </>
  );
}

interface PresetPickerProps {
  /** Whether the dialog is open. */
  open: boolean;
  /** Toggles the dialog. */
  onOpenChange: (open: boolean) => void;
  /** The issue a preset would be applied to, or `null` when none is selected. */
  issue: IssueWithTriage | null;
  /**
   * Requests staging instead of a live write. Omit it when the answer is not
   * known: the server decides the effective mode and returns it, and the toast
   * reports that answer rather than this request.
   */
  batch?: boolean;
}

/**
 * Searchable preset dialog with a preview step and an inline editor.
 *
 * @param props - {@link PresetPickerProps}
 * @returns The dialog, or `null` when no issue is selected.
 */
export function PresetPicker({ open, onOpenChange, issue, batch }: PresetPickerProps) {
  // Advisory only: the server returns the effective mode and the toast names it.
  const repoBatch = useRepoBatchMode(issue?.repoId);
  const stageMode = batch ?? repoBatch ?? false;

  // The dialog has no `DialogTrigger` — it is opened by a keyboard flag or from
  // a button in the detail pane — so Radix has no trigger to return focus to.
  // The element to hand focus back to on close.
  //
  // Tracked while the pane is closed, not read when it opens: by then Radix has
  // already moved focus into the dialog, so the elements being observed are the
  // dialog's own, which unmount on close. The pane has no trigger element to fall
  // back on — `T` opens it from anywhere — so this is the only record of where
  // the user was.
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open) return;

    function remember(event: FocusEvent) {
      const target = event.target;
      // Anything inside a dialog is the pane's own autofocus, not the place the
      // user came from.
      if (!(target instanceof HTMLElement) || target.closest('[role="dialog"]')) return;
      openerRef.current = target;
    }

    document.addEventListener("focusin", remember);
    return () => document.removeEventListener("focusin", remember);
  }, [open]);

  useEffect(() => {
    if (open) return;
    // Deferred a frame so Radix has finished its own close handling first;
    // otherwise it moves focus after this and the restore is overwritten.
    const frame = requestAnimationFrame(() => openerRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  if (!issue) return null;

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Presets"
      description="Preview and apply a saved triage decision"
      className="flex max-h-[calc(100dvh-2rem)] flex-col [&_[data-slot=command]]:min-h-0"
    >
      <PresetPickerBody issue={issue} stageMode={stageMode} onApplied={() => onOpenChange(false)} />
    </CommandDialog>
  );
}
