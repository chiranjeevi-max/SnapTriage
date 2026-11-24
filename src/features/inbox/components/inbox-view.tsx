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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/segmented-control";
import { SelectField } from "@/components/select-field";
import { cn } from "@/lib/utils";
import { IssueList } from "@/features/inbox/components/issue-list";
import { IssueDetail, type IssueDetailTarget } from "@/features/inbox/components/issue-detail";
import { QueueShortcuts } from "@/features/inbox/components/queue-shortcuts";
import { useConnectedRepos } from "@/features/repos/use-connected-repos";
import { repoNameMap } from "@/features/repos/repo-label";
import { useIssues } from "@/features/inbox/use-issues";
import type { IssueWithTriage } from "@/features/inbox/use-issues";
import { useIssueFilter } from "@/features/inbox/use-issue-filter";
import { useIssueQuery } from "@/features/inbox/use-issue-query";
import { filterByQuery } from "@/features/inbox/issue-query";
import { useIssueSort } from "@/features/inbox/use-issue-sort";
import {
  anchorSelection,
  ISSUE_SORTS,
  sortIssues,
  type IssueSort,
} from "@/features/inbox/issue-sort";
import { filterIssues, ISSUE_FILTERS } from "@/features/inbox/issue-filters";
import { useSavedViews, useSaveCurrentView } from "@/features/inbox/use-saved-views";
import { useBulkTriage } from "@/features/triage/use-bulk-triage";
import {
  toggleSelected as toggleSelectedId,
  toggleSelectAll,
  visibleSelection,
} from "@/features/triage/selection";
import { priorityOptions } from "@/features/triage/priority";
import { useKeyboardStore, useKeyboardShortcuts, ShortcutOverlay, Kbd } from "@/features/keyboard";
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
  const [savedViewId, setSavedViewId] = useState("");
  const [confirmBulkDismiss, setConfirmBulkDismiss] = useState(false);
  /**
   * Whether the detail pane owns the screen on a phone.
   *
   * The store selects row 0 on load, which used to send every phone straight
   * into the detail and hide the queue behind it. The flag starts closed, so a
   * phone lands on the queue; a row tap, Enter, or a follow-up opens the pane.
   */
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const detailOpen = useKeyboardStore((state) => state.detailOpen);
  const setDetailOpen = useKeyboardStore((state) => state.setDetailOpen);
  const bulkTriage = useBulkTriage();
  const { data: savedViews } = useSavedViews();
  const saveCurrentView = useSaveCurrentView();

  const issueList = useMemo(() => issues ?? [], [issues]);
  // The rows and the pane name their repository from the same connected-repo
  // list the sidebar already loads. The queue payload carries `repoId` only, and
  // a second per-issue request for its name would be a request per row.
  const { data: connectedRepos } = useConnectedRepos();
  const repoNames = useMemo(() => repoNameMap(connectedRepos ?? []), [connectedRepos]);
  // The query narrows first, so the count, the virtualizer, and the keyboard all
  // read the same visible list. Applying it after `filterIssues` would leave the
  // two disagreeing about what is on screen.
  const searchedIssues = useMemo(() => filterByQuery(issueList, query), [issueList, query]);
  // Sorting comes last so the visible order is the order the keyboard walks and
  // the virtualizer renders.
  const sortedIssues = useMemo(() => sortIssues(searchedIssues, sort), [searchedIssues, sort]);
  const filteredIssues = useMemo(() => filterIssues(sortedIssues, filter), [sortedIssues, filter]);

  // Individual selectors rather than the whole store. A selectorless subscription
  // re-renders this component — which owns four list memos and the virtualizer —
  // on every field, including the picker flags and the shortcut overlay, and none
  // of those change what is on screen here.
  const selectedIndex = useKeyboardStore((state) => state.selectedIndex);
  const setSelectedIndex = useKeyboardStore((state) => state.setSelectedIndex);
  const setIssueCount = useKeyboardStore((state) => state.setIssueCount);
  const moveSelection = useKeyboardStore((state) => state.moveSelection);
  const advanceFromIssueId = useKeyboardStore((state) => state.advanceFromIssueId);
  const clearAdvance = useKeyboardStore((state) => state.clearAdvance);
  const toggleOverlay = useKeyboardStore((state) => state.toggleOverlay);
  const setBulkConfirmOpen = useKeyboardStore((state) => state.setBulkConfirmOpen);
  const labelPickerOpen = useKeyboardStore((state) => state.labelPickerOpen);
  const setLabelPickerOpen = useKeyboardStore((state) => state.setLabelPickerOpen);
  const assigneePickerOpen = useKeyboardStore((state) => state.assigneePickerOpen);
  const setAssigneePickerOpen = useKeyboardStore((state) => state.setAssigneePickerOpen);
  const snoozePickerOpen = useKeyboardStore((state) => state.snoozePickerOpen);
  const setSnoozePickerOpen = useKeyboardStore((state) => state.setSnoozePickerOpen);
  const presetPickerOpen = useKeyboardStore((state) => state.presetPickerOpen);
  const setPresetPickerOpen = useKeyboardStore((state) => state.setPresetPickerOpen);

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

  // A triage action that removed its row already left the next issue under the
  // selection; moving would skip it. A row that stayed (a dismissal under All)
  // leaves the cursor where it was, so the clearing loop needs one move. The
  // selection must still be the acted row: a user who moved on before the write
  // settled does not get pulled forward.
  useEffect(() => {
    if (advanceFromIssueId === null) return;
    if (filteredIssues[selectedIndex]?.id === advanceFromIssueId) {
      moveSelection(1, { openDetail: false });
    }
    clearAdvance();
  }, [advanceFromIssueId, filteredIssues, selectedIndex, moveSelection, clearAdvance]);

  const toggleSelected = useCallback((issueId: string) => {
    setSelectedIds((previous) => toggleSelectedId(previous, issueId));
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  /**
   * The active narrowing, named the way the controls name it.
   *
   * Only used to explain an empty queue. Without it the empty state cannot tell
   * a first-use queue from a search that hid everything.
   */
  const activeFilterLabel =
    ISSUE_FILTERS.find((option) => option.value === filter)?.label ?? filter;
  const narrowedBy = useMemo(() => {
    const narrowing: string[] = [];
    const trimmed = queryText.trim();
    if (trimmed) narrowing.push(`the search “${trimmed}”`);
    if (filter !== "all") narrowing.push(`the “${activeFilterLabel}” filter`);
    return narrowing;
  }, [queryText, filter, activeFilterLabel]);

  const clearNarrowing = useCallback(() => {
    setQueryText("");
    setFilter("all");
    setSavedViewId("");
    clearSelection();
    setPinnedIssue(null);
  }, [setQueryText, setFilter, clearSelection]);

  // The flag has to be released if the route unmounts with the confirmation
  // open, or every later shortcut stays muted for the session.
  useEffect(() => () => setBulkConfirmOpen(false), [setBulkConfirmOpen]);

  const detailEmptyDescription = !detailOpen
    ? "Details are closed. Press Enter or select a row to read it here."
    : issueList.length === 0
      ? "Issues appear here after a repository is connected and synced."
      : filteredIssues.length === 0
        ? "Clear the search or filter to choose an issue."
        : "Select a row in the queue to read it here.";

  const selectAllVisible = useCallback(() => {
    // The follow-up surface shows no queue rows, so there is nothing to select
    // there. Allowing it would expose the bulk bar and let its actions mutate
    // issues the user cannot see.
    if (surface !== "queue") return;
    setSelectedIds((previous) => toggleSelectAll(previous, filteredIssues));
  }, [surface, filteredIssues]);

  // Passed to the keyboard dispatcher rather than routed through the store: the
  // selection is view state, and this closes over the list that is on screen.
  const keyboardOptions = useMemo(
    () => ({
      toggleSelection: toggleSelected,
      selectAllVisible,
      openDetail: () => {
        setDetailOpen(true);
        setMobileDetailOpen(true);
      },
      closeDetail: () => {
        setDetailOpen(false);
        setMobileDetailOpen(false);
      },
      // The queue is the only surface where the cursor names a visible row, and
      // a pinned follow-up has no visible row at all: it may share the queue
      // surface, but `z` there would reverse an unrelated action.
      undoAllowed: surface === "queue" && pinnedIssue === null,
    }),
    [toggleSelected, selectAllVisible, setDetailOpen, surface, pinnedIssue]
  );

  const visibleSelectedIds = useMemo(
    () => visibleSelection(selectedIds, filteredIssues),
    [selectedIds, filteredIssues]
  );
  const allVisibleSelected =
    filteredIssues.length > 0 && visibleSelectedIds.length === filteredIssues.length;
  const selectedPreview = useMemo(
    () =>
      filteredIssues
        .filter((issue) => selectedIds.has(issue.id))
        .slice(0, 3)
        .map((issue) => issue.title),
    [filteredIssues, selectedIds]
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

  // Keep the selection on the same issue when the list is reordered or narrowed.
  //
  // The anchor has to come from the *previous* list. Reading it from the current
  // one after the swap would read whatever now sits at that index, so a search or
  // sort change silently moved the selection to a different issue and the next
  // keystroke acted on it.
  const previousListRef = useRef<IssueWithTriage[]>(filteredIssues);
  useEffect(() => {
    const previous = previousListRef.current;
    previousListRef.current = filteredIssues;
    if (previous === filteredIssues) return;

    const nextIndex = anchorSelection(previous, filteredIssues, selectedIndex);
    if (nextIndex !== null && nextIndex !== selectedIndex) setSelectedIndex(nextIndex);
  }, [filteredIssues, selectedIndex, setSelectedIndex]);

  useKeyboardShortcuts(shownIssues, keyboardOptions);

  const handleSelect = useCallback(
    (issue: { id: string }) => {
      const idx = filteredIssues.findIndex((i) => i.id === issue.id);
      if (idx >= 0) {
        setPinnedIssue(null);
        setSelectedIndex(idx);
        setDetailOpen(true);
        setMobileDetailOpen(true);
      }
    },
    [filteredIssues, setSelectedIndex, setDetailOpen]
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
      // The index must come from the list the keyboard actually navigates, which
      // is the searched and sorted one, and with the filter forced to `all` below.
      // Searching the raw queue pointed at a different row whenever a query or a
      // non-default sort was active, or found nothing at all.
      const targetList = filterIssues(sortIssues(filterByQuery(issueList, query), sort), "all");
      const idx = targetList.findIndex((issue) => issue.id === entry.issueId);
      setPinnedIssue(idx >= 0 ? null : entry);
      setSurface("queue");
      setFilter("all");
      setSelectedIndex(idx);
      setDetailOpen(true);
      setMobileDetailOpen(true);
    },
    [issueList, query, sort, setFilter, setSelectedIndex, setDetailOpen]
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
        currentIssue && detailOpen && mobileDetailOpen && "has-selection"
      )}
    >
      {/* Toolbar */}
      <div className="inbox-toolbar flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-6 py-4">
        <div className="inbox-heading flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="mr-1 shrink-0 text-xl font-semibold tracking-tight">Inbox</h1>
          {issues && surface === "queue" && (
            <span className="hidden shrink-0 whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground sm:inline">
              {filteredIssues.length === issues.length
                ? `${issues.length} issue${issues.length === 1 ? "" : "s"}`
                : `${filteredIssues.length} of ${issues.length}`}
            </span>
          )}
          {/* The surface switch belongs with the page identity, not with the
              narrowing controls: Queue and Follow-ups are two lists of the same
              inbox, not filters of the queue. */}
          <SegmentedControl
            ariaLabel="Inbox surface"
            options={SURFACES}
            value={surface}
            onChange={(next) => {
              setSurface(next);
              // Leaving the queue clears the bulk selection: its buttons act on
              // queue rows, and those are not on screen while the follow-ups are.
              if (next === "follow-ups") {
                clearSelection();
                setMobileDetailOpen(false);
              }
            }}
          />
        </div>
        <div
          className="inbox-controls flex min-w-0 flex-wrap items-center gap-2"
          role="toolbar"
          aria-label="Inbox controls"
        >
          {/* The queue filters and the follow-up list are alternatives, not
              layers: a follow-up row can be dismissed, snoozed, or closed, so
              applying the queue's filter to it would hide the rows the queue
              exists to surface. The controls hide rather than sit inert. */}
          {surface === "queue" ? (
            <>
              <span id="issue-search-help" className="sr-only">
                Narrow the queue by label, author, or issue number. Use label:bug, author:nadia, or
                #123.
              </span>
              <Input
                type="search"
                aria-label="Search issues"
                aria-describedby="issue-search-help"
                placeholder="Search issues…"
                title="Filter by label, author, or issue number: label:bug, author:nadia, #123"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                className="inbox-search h-9 w-full min-w-[12rem] max-w-[20rem] flex-1 text-sm"
              />
              <SelectField
                aria-label="Sort issues"
                value={sort}
                onChange={(event) => setSort(event.target.value as IssueSort)}
              >
                {ISSUE_SORTS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Sort: {option.label}
                  </option>
                ))}
              </SelectField>
              <SelectField
                aria-label="Filter issues"
                value={filter}
                onChange={(event) => {
                  setFilter(event.target.value as (typeof ISSUE_FILTERS)[number]["value"]);
                  setSavedViewId("");
                  clearSelection();
                }}
              >
                {ISSUE_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    Filter: {option.label}
                  </option>
                ))}
              </SelectField>
              {savedViews && savedViews.length > 0 && (
                <div className="hidden sm:block">
                  <SelectField
                    aria-label="Saved views"
                    value={savedViewId}
                    className="w-full max-w-[9rem] xl:max-w-[12rem]"
                    onChange={(event) => {
                      const id = event.target.value;
                      setSavedViewId(id);
                      const view = savedViews.find((item) => item.id === id);
                      if (view) {
                        setFilter(view.filter);
                        clearSelection();
                      }
                    }}
                  >
                    <option value="">Saved views</option>
                    {savedViews.map((view) => (
                      <option key={view.id} value={view.id}>
                        {view.name}
                      </option>
                    ))}
                  </SelectField>
                </div>
              )}
            </>
          ) : null}
          {surface === "queue" &&
            (namingView ? (
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
                className="h-9 min-w-0 max-w-full w-full sm:w-44 rounded-md border border-input bg-background px-2 text-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none"
              />
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="hidden h-9 w-9 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground sm:inline-flex xl:w-auto"
                title="Save the current filter as a view"
                onClick={() => {
                  setViewName("");
                  setNamingView(true);
                }}
              >
                <BookmarkPlus className="h-3.5 w-3.5" />
                <span className="sr-only xl:not-sr-only">Save view</span>
              </Button>
            ))}
        </div>

        <div className="inbox-sync">
          <SyncStatus />
        </div>
      </div>

      {/* Split pane */}
      <ResizablePanelGroup orientation="horizontal" className="triage-panels min-h-0 flex-1">
        <ResizablePanel defaultSize="42%" minSize="28%">
          <div className="flex h-full min-h-0 flex-col">
            <div className="min-h-0 flex-1">
              {surface === "queue" ? (
                <IssueList
                  issues={filteredIssues}
                  selectedIndex={selectedIndex}
                  onSelect={handleSelect}
                  isLoading={isLoading}
                  selectedIds={selectedIds}
                  onToggleSelected={toggleSelected}
                  repoNames={repoNames}
                  narrowedBy={narrowedBy}
                  onClearNarrowing={clearNarrowing}
                />
              ) : (
                <FollowUpView onOpenIssue={handleOpenFollowUp} />
              )}
            </div>
            {surface === "queue" && visibleSelectedIds.length > 0 ? (
              // The bulk bar belongs to the queue, not the page toolbar. Here it
              // replaces the shortcut footer for one row instead of growing the
              // toolbar and pushing the whole split pane down mid-task.
              <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-t bg-card px-3 py-1.5">
                <span
                  className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                  aria-live="polite"
                >
                  {visibleSelectedIds.length} selected
                </span>
                <div
                  className="flex min-w-0 flex-wrap items-center gap-1"
                  aria-busy={bulkTriage.isPending}
                >
                  {priorityOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      disabled={bulkTriage.isPending}
                      onClick={() => runBulk({ priority: option.value })}
                      className={cn(
                        "h-8 shrink-0 rounded-md border px-2 text-xs font-medium transition-opacity hover:opacity-90",
                        option.className
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    disabled={bulkTriage.isPending}
                    onClick={() => {
                      setConfirmBulkDismiss(true);
                      setBulkConfirmOpen(true);
                    }}
                  >
                    Dismiss selected
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    disabled={bulkTriage.isPending}
                    onClick={() => runBulk({ dismissed: false })}
                  >
                    Undismiss selected
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    onClick={selectAllVisible}
                  >
                    {allVisibleSelected ? "Clear selection" : "Select all"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 px-2 text-xs"
                    onClick={clearSelection}
                  >
                    Clear
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label="Keyboard shortcuts"
                    onClick={toggleOverlay}
                  >
                    <Kbd>?</Kbd>
                  </Button>
                </div>
              </div>
            ) : surface === "queue" && filteredIssues.length > 0 ? (
              <QueueShortcuts onSelectAll={selectAllVisible} />
            ) : null}
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="58%" minSize="32%">
          <IssueDetail
            issue={detailOpen ? currentIssue : null}
            repoNames={repoNames}
            emptyTitle={detailOpen ? "No issue selected" : "Details closed"}
            emptyDescription={detailEmptyDescription}
            triagePaused={surface === "follow-ups"}
            // A pinned follow-up is not a queue row, so the keyboard dispatcher
            // has no current issue and `c` cannot fire for it.
            shortcutTarget={currentIssue !== null && currentIssue === queueIssue}
            onClose={() => {
              // Closing the pane no longer clears the cursor: the row stays
              // selected and the next j/k moves from it.
              setPinnedIssue(null);
              setDetailOpen(false);
              setMobileDetailOpen(false);
            }}
          />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* The follow-up list owns the whole pane on phones. `has-selection` hides
          the queue and shows the detail at full width; while the follow-ups are
          up there is no queue row to hide, so the selection class is dropped and
          the list keeps the screen even though the detail pane still holds the
          last issue and its unsaved reply. */}
      <BatchStatusBar />

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

      {/* Dismissing a selection is the one bulk action that changes what is on
          screen with no undo path; the other bulk actions are reversible by
          selecting the rows again. */}
      <AlertDialog
        open={confirmBulkDismiss}
        onOpenChange={(open) => {
          setConfirmBulkDismiss(open);
          setBulkConfirmOpen(open);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Dismiss {visibleSelectedIds.length} issue{visibleSelectedIds.length === 1 ? "" : "s"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Dismissed issues leave the queue. You can show them again with the Dismissed filter
              and undismiss them there.
              {selectedPreview.length > 0 && (
                <span className="mt-1 block text-foreground">
                  Includes{" "}
                  {selectedPreview
                    .map((title) => `“${title.length > 48 ? `${title.slice(0, 48)}…` : title}”`)
                    .join(", ")}
                  {visibleSelectedIds.length > selectedPreview.length
                    ? ` and ${visibleSelectedIds.length - selectedPreview.length} more`
                    : ""}
                  .
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => runBulk({ dismissed: true })}
            >
              Dismiss {visibleSelectedIds.length} issue{visibleSelectedIds.length === 1 ? "" : "s"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShortcutOverlay />
    </div>
  );
}
