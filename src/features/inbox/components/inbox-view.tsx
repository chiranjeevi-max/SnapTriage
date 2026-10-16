/**
 * @module inbox/components/inbox-view
 *
 * Main inbox layout component. Combines the issue list, detail pane, triage pickers,
 * batch status bar, and keyboard shortcut overlay into a resizable split-pane view.
 *
 * State flow:
 * - Issues are fetched via {@link useIssues} (auto-polling)
 * - Selection index lives in the global keyboard store (Zustand)
 * - Picker dialogs (labels, assignees, snooze) are toggled via keyboard store flags
 */
"use client";

import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { IssueList } from "./issue-list";
import { IssueDetail } from "./issue-detail";
import { useIssues } from "../use-issues";
import { useIssueFilter } from "../use-issue-filter";
import { filterIssues, ISSUE_FILTERS } from "../issue-filters";
import { useBulkTriage } from "@/features/triage/use-bulk-triage";
import { useKeyboardStore, useKeyboardShortcuts, ShortcutOverlay } from "@/features/keyboard";
import {
  LabelPicker,
  AssigneePicker,
  SnoozePicker,
  BatchStatusBar,
  SyncStatus,
} from "@/features/triage";

/**
 * Top-level inbox view with resizable issue list + detail split pane.
 * Wires keyboard shortcuts, picker dialogs, and sync status together.
 */
export function InboxView() {
  const { data: issues, isLoading } = useIssues();
  const [filter, setFilter] = useIssueFilter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const bulkTriage = useBulkTriage();

  const issueList = useMemo(() => issues ?? [], [issues]);
  const filteredIssues = useMemo(() => filterIssues(issueList, filter), [issueList, filter]);

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
  } = useKeyboardStore();

  // Keep issueCount in sync with the filtered list so keyboard nav stays in bounds
  useEffect(() => {
    setIssueCount(filteredIssues.length);
  }, [filteredIssues.length, setIssueCount]);

  const toggleSelected = useCallback((issueId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const visibleSelectedIds = useMemo(
    () => [...selectedIds].filter((id) => filteredIssues.some((issue) => issue.id === id)),
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

  // Derive current issue from the filtered list so keyboard nav follows the view
  const currentIssue = selectedIndex >= 0 ? (filteredIssues[selectedIndex] ?? null) : null;

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

  // Wire up keyboard shortcuts
  useKeyboardShortcuts(filteredIssues);

  // When user clicks an issue, update the store index
  const handleSelect = useCallback(
    (issue: { id: string }) => {
      const idx = filteredIssues.findIndex((i) => i.id === issue.id);
      if (idx >= 0) setSelectedIndex(idx);
    },
    [filteredIssues, setSelectedIndex]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div
        className="flex items-center justify-between border-b px-4 py-2"
        role="toolbar"
        aria-label="Inbox toolbar"
      >
        <div className="flex items-center gap-2">
          <h1 className="text-sm font-semibold">Inbox</h1>
          {issues && (
            <span className="text-xs text-muted-foreground">
              {filteredIssues.length} of {issues.length}
            </span>
          )}
          <select
            aria-label="Filter issues"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value as (typeof ISSUE_FILTERS)[number]["value"]);
              clearSelection();
            }}
            className="h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground"
          >
            {ISSUE_FILTERS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {selectedIds.size > 0 && (
          <div
            className="flex items-center gap-2 text-xs"
            aria-live="polite"
            aria-busy={bulkTriage.isPending}
          >
            <span className="text-muted-foreground">{visibleSelectedIds.length} selected</span>
            <button
              type="button"
              disabled={bulkTriage.isPending}
              onClick={() => runBulk({ priority: 0 })}
              className="rounded border px-2 py-1"
            >
              P0
            </button>
            <button
              type="button"
              disabled={bulkTriage.isPending}
              onClick={() => runBulk({ priority: 1 })}
              className="rounded border px-2 py-1"
            >
              P1
            </button>
            <button
              type="button"
              disabled={bulkTriage.isPending}
              onClick={() => runBulk({ priority: 2 })}
              className="rounded border px-2 py-1"
            >
              P2
            </button>
            <button
              type="button"
              disabled={bulkTriage.isPending}
              onClick={() => runBulk({ priority: 3 })}
              className="rounded border px-2 py-1"
            >
              P3
            </button>
            <button
              type="button"
              disabled={bulkTriage.isPending}
              onClick={() => runBulk({ dismissed: true })}
              className="rounded border px-2 py-1"
            >
              Dismiss
            </button>
            <button
              type="button"
              disabled={bulkTriage.isPending}
              onClick={() => runBulk({ dismissed: false })}
              className="rounded border px-2 py-1"
            >
              Undismiss
            </button>
            <button
              type="button"
              disabled={bulkTriage.isPending}
              onClick={clearSelection}
              className="rounded border px-2 py-1"
            >
              Clear
            </button>
          </div>
        )}
        <SyncStatus />
      </div>

      {/* Split pane */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize={40} minSize={25}>
          <IssueList
            issues={filteredIssues}
            selectedIndex={selectedIndex}
            onSelect={handleSelect}
            isLoading={isLoading}
            selectedIds={selectedIds}
            onToggleSelected={toggleSelected}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={60} minSize={30}>
          <IssueDetail issue={currentIssue} onClose={() => setSelectedIndex(-1)} />
        </ResizablePanel>
      </ResizablePanelGroup>

      {/* Batch status bar */}
      <BatchStatusBar />

      {/* Picker dialogs */}
      <LabelPicker open={labelPickerOpen} onOpenChange={setLabelPickerOpen} issue={currentIssue} />
      <AssigneePicker
        open={assigneePickerOpen}
        onOpenChange={setAssigneePickerOpen}
        issue={currentIssue}
      />
      <SnoozePicker
        open={snoozePickerOpen}
        onOpenChange={setSnoozePickerOpen}
        issue={currentIssue}
      />

      <ShortcutOverlay />
    </div>
  );
}
