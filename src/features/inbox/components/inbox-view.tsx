/**
 * @module inbox/components/inbox-view
 *
 * Main inbox layout component. Combines the issue list, detail pane, triage pickers,
 * batch status bar, and keyboard shortcut overlay into a resizable split-pane view.
 *
 * The toolbar also swaps the queue for the follow-up list. That is a separate
 * surface rather than a sixth filter for `issue-filters.ts`: a follow-up is
 * cross-state, so it has to show issues a filter would hide, and
 * `matchesIssueFilter` is pure and pinned to five values by its own test.
 *
 * State flow:
 * - Issues are fetched via {@link useIssues} (auto-polling)
 * - Selection index lives in the global keyboard store (Zustand)
 * - Picker dialogs (labels, assignees, snooze, presets) are toggled via keyboard store flags
 */
"use client";

import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import { BellRing, BookmarkPlus, List } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/segmented-control";
import { SelectField } from "@/components/select-field";
import { cn } from "@/lib/utils";
import { IssueList } from "@/features/inbox/components/issue-list";
import { IssueDetail, type IssueDetailTarget } from "@/features/inbox/components/issue-detail";
import { useIssues } from "@/features/inbox/use-issues";
import type { IssueWithTriage } from "@/features/inbox/use-issues";
import { useIssueFilter } from "@/features/inbox/use-issue-filter";
import { useIssueQuery } from "@/features/inbox/use-issue-query";
import { filterByQuery } from "@/features/inbox/issue-query";
import { useIssueSort } from "@/features/inbox/use-issue-sort";
import { ISSUE_SORTS, sortIssues, type IssueSort } from "@/features/inbox/issue-sort";
import { filterIssues, ISSUE_FILTERS } from "@/features/inbox/issue-filters";
import { useSavedViews, useSaveCurrentView } from "@/features/inbox/use-saved-views";
import { useBulkTriage } from "@/features/triage/use-bulk-triage";
import {
  toggleSelected as toggleSelectedId,
  toggleSelectAll,
  visibleSelection,
} from "@/features/triage/selection";
import { priorityOptions } from "@/features/triage/priority";
import { useKeyboardStore, useKeyboardShortcuts, ShortcutOverlay } from "@/features/keyboard";
import {
  LabelPicker,
  AssigneePicker,
  SnoozePicker,
  BatchStatusBar,
  SyncStatus,
} from "@/features/triage";
import { PresetPicker } from "@/features/presets";
import { FollowUpView, type FollowUpEntry } from "@/features/follow-up";

/** Which surface the list pane is showing. */
type InboxSurface = "queue" | "follow-ups";

/** The toolbar toggle's options. */
const SURFACES: Array<{ value: InboxSurface; label: string; icon: React.ReactNode }> = [
  { value: "queue", label: "Queue", icon: <List className="h-3 w-3" /> },
  { value: "follow-ups", label: "Follow-ups", icon: <BellRing className="h-3 w-3" /> },
];

/**
 * The list the keyboard dispatcher receives while the follow-ups are showing.
 *
 * A shared empty array rather than a fresh `[]` per render, so the memoised
 * dispatcher is not rebuilt for a list that is empty by definition.
 */
const NO_ISSUES: IssueWithTriage[] = [];

/**
 * What the detail pane shows: a selected queue row, or the pinned follow-up.
 *
 * A selected queue row wins. The pin exists for an issue that is *not* in the
 * queue, which is why `handleOpenFollowUp` sets the index to -1 when it pins. If
 * a stale pin outranked the selection, moving down from the follow-up list would
 * display one issue while every shortcut acted on another — the dismiss would
 * land on a row the user cannot see.
 *
 * @param pinned - The follow-up pinned into the pane, if any.
 * @param queueIssue - The row the queue selection points at, if any.
 * @returns The issue the pane should render.
 */
export function resolveDetailTarget(
  pinned: FollowUpEntry | null,
  queueIssue: IssueDetailTarget | null
): IssueDetailTarget | null {
  if (queueIssue) return queueIssue;
  if (pinned === null) return null;
  return {
    id: pinned.issueId,
    provider: pinned.provider,
    url: pinned.url,
    number: pinned.number,
    title: pinned.title,
  };
}

/**
 * Top-level inbox view with resizable issue list + detail split pane.
 * Wires keyboard shortcuts, picker dialogs, and sync status together.
 */
export function InboxView() {
  const { data: issues, isLoading } = useIssues();
  const [filter, setFilter] = useIssueFilter();
  const [queryText, setQueryText, query] = useIssueQuery();
  const [sort, setSort] = useIssueSort();
  const [surface, setSurface] = useState<InboxSurface>("queue");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  /**
   * A follow-up entry the queue cannot reach, shown instead of the queue row.
   *
   * Closed issues are absent from the queue by design, so this is the only way
   * the pane can show one. Cleared as soon as the user selects a real row.
   */
  const [pinnedIssue, setPinnedIssue] = useState<FollowUpEntry | null>(null);
  const [namingView, setNamingView] = useState(false);
  const [viewName, setViewName] = useState("");
  const bulkTriage = useBulkTriage();
  const { data: savedViews } = useSavedViews();
  const saveCurrentView = useSaveCurrentView();

  const issueList = useMemo(() => issues ?? [], [issues]);
  // The query narrows first, so the count, the virtualizer, and the keyboard all
  // read the same visible list. Applying it after `filterIssues` would leave the
  // two disagreeing about what is on screen.
  const searchedIssues = useMemo(() => filterByQuery(issueList, query), [issueList, query]);
  // Sorting comes last so the visible order is the order the keyboard walks and
  // the virtualizer renders.
  const sortedIssues = useMemo(() => sortIssues(searchedIssues, sort), [searchedIssues, sort]);
  const filteredIssues = useMemo(() => filterIssues(sortedIssues, filter), [sortedIssues, filter]);

  const {
    selectedIndex,
    setSelectedIndex,
    setIssueCount,
    labelPickerOpen,
    setLabelPickerOpen,
    assigneePickerOpen,
    setAssigneePickerOpen,
    snoozePickerOpen,
    setSnoozePickerOpen,
    presetPickerOpen,
    setPresetPickerOpen,
    selectionRequest,
    setSelectionRequest,
  } = useKeyboardStore();

  // The follow-up surface replaces the queue in the list pane, so the keyboard
  // must act on what is on screen and nothing else. An empty list makes every
  // action a no-op while the follow-ups are showing: `d` behind the queue would
  // otherwise dismiss an issue nobody can see. `setIssueCount` only clamps the
  // selection downwards, so returning to the queue keeps the row that was
  // selected when the user left it.
  //
  // It replaces the list, not the whole split pane. The detail pane holds the
  // reply composer, and unmounting it to show the queue would throw away text
  // mid-debounce. `surface` is additive on top of the queue, so coming back
  // restores the same selection.
  const shownIssues = surface === "queue" ? filteredIssues : NO_ISSUES;

  // Keep issueCount in sync with the list the keyboard is actually navigating.
  // `null` on the follow-up surface: it is not the queue, so the preserved queue
  // selection must survive a visit there unchanged.
  useEffect(() => {
    setIssueCount(surface === "queue" ? filteredIssues.length : null);
  }, [surface, filteredIssues.length, setIssueCount]);

  const toggleSelected = useCallback((issueId: string) => {
    setSelectedIds((previous) => toggleSelectedId(previous, issueId));
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // The keyboard asks for a selection change; only this view knows which rows are
  // visible, so the request is resolved during render against the current
  // selection. Resolving it in an effect would apply one frame late, and the
  // state write there would be a cascading render.
  if (selectionRequest) {
    const request = selectionRequest;
    setSelectionRequest(null);
    setSelectedIds((previous) =>
      request.action === "toggle"
        ? toggleSelectedId(previous, request.issueId)
        : toggleSelectAll(previous, filteredIssues)
    );
  }

  const visibleSelectedIds = useMemo(
    () => visibleSelection(selectedIds, filteredIssues),
    [selectedIds, filteredIssues]
  );

  const runBulk = useCallback(
    (payload: Parameters<typeof bulkTriage.mutate>[0]["payload"]) => {
      if (visibleSelectedIds.length === 0) return;
      bulkTriage.mutate(
        { issueIds: visibleSelectedIds, payload },
        { onSuccess: () => clearSelection() }
      );
    },
    [visibleSelectedIds, bulkTriage, clearSelection]
  );

  // Derive current issue from the filtered list, not from what the list pane is
  // showing. The detail pane keeps rendering the last selected issue while the
  // follow-ups are up, because it holds the reply composer and swapping in an
  // empty state would discard text that has not been saved yet. The keyboard is
  // told about the empty list separately, so the shortcuts still do nothing.
  const queueIssue = selectedIndex >= 0 ? (filteredIssues[selectedIndex] ?? null) : null;
  /**
   * The entry the pane shows. A pinned follow-up is mapped to the pane's shape
   * here rather than carried as two unions through every prop: `FollowUpEntry`
   * names the issue `issueId`, and the pane only needs an id to fetch by.
   */
  const currentIssue = useMemo(
    () => resolveDetailTarget(pinnedIssue, queueIssue),
    [pinnedIssue, queueIssue]
  );

  // Stabilize selection after data refresh
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentIssue) selectedIdRef.current = currentIssue.id;
  }, [currentIssue]);

  useEffect(() => {
    if (selectedIdRef.current && filteredIssues.length > 0) {
      const idx = filteredIssues.findIndex((i) => i.id === selectedIdRef.current);
      if (idx >= 0) setSelectedIndex(idx);
    }
  }, [filteredIssues, setSelectedIndex]);

  useKeyboardShortcuts(shownIssues);

  const handleSelect = useCallback(
    (issue: { id: string }) => {
      const idx = filteredIssues.findIndex((i) => i.id === issue.id);
      if (idx >= 0) {
        setPinnedIssue(null);
        setSelectedIndex(idx);
      }
    },
    [filteredIssues, setSelectedIndex]
  );

  /**
   * Opens one follow-up row in the detail pane.
   *
   * A follow-up can point at an issue the current filter hides, and the detail
   * pane indexes into `filteredIssues`, so switching back to the queue without
   * a filter change would select a different row or none. The filter is reset to
   * `all` so the row the user clicked is the row that gets rendered.
   */
  /**
   * Open a follow-up entry in the detail pane.
   *
   * `useIssues` asks the server for `state=open`, so a closed issue is never in
   * the queue and cannot be selected by index. Waiting can be armed on a closed
   * issue and the follow-up queue lists it, so the entry itself becomes the
   * pane's source: `IssueDetail` fetches by id, and a closed issue resolves
   * through that even though it has no row in the list.
   */
  const handleOpenFollowUp = useCallback(
    (entry: FollowUpEntry) => {
      const idx = filterIssues(issueList, "all").findIndex((issue) => issue.id === entry.issueId);
      setPinnedIssue(idx >= 0 ? null : entry);
      setSurface("queue");
      setFilter("all");
      setSelectedIndex(idx);
    },
    [issueList, setFilter, setSelectedIndex]
  );

  /** Saves the current filter as a named view and closes the name field. */
  function commitViewName() {
    const name = viewName.trim();
    setNamingView(false);
    setViewName("");
    if (!name) return;
    saveCurrentView.mutate({ name, filter });
  }

  return (
    <div
      className={cn(
        "triage-inbox flex h-full min-h-0 flex-col",
        currentIssue && surface === "queue" && "has-selection"
      )}
    >
      {/* Toolbar */}
      <div
        className="inbox-toolbar flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b px-6 py-5"
        role="toolbar"
        aria-label="Inbox toolbar"
      >
        <div className="inbox-heading flex min-w-0 items-center gap-3">
          <h1 className="mr-1 shrink-0 text-xl font-semibold tracking-tight">Inbox</h1>
          {issues && surface === "queue" && (
            <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
              {filteredIssues.length} of {issues.length}
            </span>
          )}
        </div>
        <div className="inbox-controls flex min-w-0 flex-wrap items-center gap-2">
          <SegmentedControl
            ariaLabel="Inbox surface"
            options={SURFACES}
            value={surface}
            onChange={(next) => {
              setSurface(next);
              // Leaving the queue clears the bulk selection: its buttons act on
              // queue rows, and those are not on screen while the follow-ups are.
              if (next === "follow-ups") clearSelection();
            }}
          />
          {/* The queue filters and the follow-up list are alternatives, not
              layers: a follow-up row can be dismissed, snoozed, or closed, so
              applying the queue's filter to it would hide the rows the queue
              exists to surface. The controls hide rather than sit inert. */}
          {surface === "queue" ? (
            <>
              <Input
                type="search"
                aria-label="Search issues"
                placeholder="Search… (label:bug, author:me, #123)"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                className="h-9 w-full min-w-0 max-w-[16rem] flex-1 text-sm sm:max-w-[20rem]"
              />
              <SelectField
                aria-label="Sort issues"
                value={sort}
                onChange={(event) => setSort(event.target.value as IssueSort)}
              >
                {ISSUE_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
              <SelectField
                aria-label="Filter issues"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value as (typeof ISSUE_FILTERS)[number]["value"]);
                  clearSelection();
                }}
              >
                {ISSUE_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </SelectField>
              {savedViews && savedViews.length > 0 && (
                <SelectField
                  aria-label="Saved views"
                  value=""
                  className="w-full max-w-[8rem] sm:max-w-[12rem]"
                  onChange={(event) => {
                    const view = savedViews.find((item) => item.id === event.target.value);
                    if (view) setFilter(view.filter);
                  }}
                >
                  <option value="">Saved views</option>
                  {savedViews.map((view) => (
                    <option key={view.id} value={view.id}>
                      {view.name}
                    </option>
                  ))}
                </SelectField>
              )}
            </>
          ) : null}
          {namingView ? (
            <input
              autoFocus
              value={viewName}
              aria-label="Name this view"
              placeholder="Name this view"
              onChange={(event) => setViewName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitViewName();
                }
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setNamingView(false);
                  setViewName("");
                }
              }}
              className="h-9 min-w-0 max-w-full w-full sm:w-44 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
            />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 w-9 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground sm:w-auto"
              onClick={() => {
                setViewName("");
                setNamingView(true);
              }}
            >
              <BookmarkPlus className="h-3.5 w-3.5" />
              <span className="sr-only sm:not-sr-only">Save view</span>
            </Button>
          )}
        </div>

        {selectedIds.size > 0 && (
          <div className="inbox-bulk flex min-w-0 max-w-full flex-wrap items-center justify-start gap-x-3 gap-y-2">
            <span
              className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
              aria-live="polite"
            >
              {visibleSelectedIds.length} selected
            </span>
            <div
              className="flex min-w-0 max-w-full flex-wrap items-center gap-2"
              aria-busy={bulkTriage.isPending}
            >
              {priorityOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  disabled={bulkTriage.isPending}
                  onClick={() => runBulk({ priority: option.value })}
                  className={cn(
                    "h-9 rounded-md border px-2.5 text-xs font-medium transition-opacity hover:opacity-90",
                    option.className
                  )}
                >
                  {option.label}
                </button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2.5 text-xs"
                disabled={bulkTriage.isPending}
                onClick={() => runBulk({ dismissed: true })}
              >
                Dismiss
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2.5 text-xs"
                disabled={bulkTriage.isPending}
                onClick={() => runBulk({ dismissed: false })}
              >
                Undismiss
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-9 px-2.5 text-xs"
                onClick={clearSelection}
              >
                Clear
              </Button>
            </div>
          </div>
        )}
        <div className="inbox-sync">
          <SyncStatus />
        </div>
      </div>

      {/* Split pane */}
      <ResizablePanelGroup orientation="horizontal" className="triage-panels min-h-0 flex-1">
        <ResizablePanel defaultSize="42%" minSize="28%">
          {surface === "queue" ? (
            <IssueList
              issues={filteredIssues}
              selectedIndex={selectedIndex}
              onSelect={handleSelect}
              isLoading={isLoading}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
            />
          ) : (
            <FollowUpView onOpenIssue={handleOpenFollowUp} />
          )}
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="58%" minSize="32%">
          <IssueDetail
            issue={currentIssue}
            onClose={() => {
              // The pin outlives the selection, so closing has to clear it too.
              // Without this, Escape closes a pinned follow-up and the pane
              // reopens it on the next render.
              setPinnedIssue(null);
              setSelectedIndex(-1);
            }}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* The follow-up list owns the whole pane on phones. `has-selection` hides
          the queue and shows the detail at full width; while the follow-ups are
          up there is no queue row to hide, so the selection class is dropped and
          the list keeps the screen even though the detail pane still holds the
          last issue and its unsaved reply. */}
      <BatchStatusBar issues={issueList} />

      {/* Picker dialogs */}
      <LabelPicker open={labelPickerOpen} onOpenChange={setLabelPickerOpen} issue={queueIssue} />
      {/* The pickers edit the selected queue row. A pinned follow-up has no row
          and no cached labels or assignees, so it gets none of them rather than
          acting on the row that happens to be selected behind it. */}
      <AssigneePicker
        open={assigneePickerOpen}
        onOpenChange={setAssigneePickerOpen}
        issue={queueIssue}
      />
      <SnoozePicker open={snoozePickerOpen} onOpenChange={setSnoozePickerOpen} issue={queueIssue} />
      <PresetPicker open={presetPickerOpen} onOpenChange={setPresetPickerOpen} issue={queueIssue} />

      <ShortcutOverlay />
    </div>
  );
}
