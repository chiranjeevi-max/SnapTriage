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

import { useEffect, useMemo, useRef } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { IssueList } from "./issue-list";
import { IssueDetail } from "./issue-detail";
import { useIssues } from "../use-issues";
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

  const issueList = useMemo(() => issues ?? [], [issues]);

  // Keep issueCount in sync
  useEffect(() => {
    setIssueCount(issueList.length);
  }, [issueList.length, setIssueCount]);

  // Derive current issue from index
  const currentIssue = selectedIndex >= 0 ? (issueList[selectedIndex] ?? null) : null;

  // Stabilize selection after data refresh
  const selectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentIssue) selectedIdRef.current = currentIssue.id;
  }, [currentIssue]);

  useEffect(() => {
    if (selectedIdRef.current && issueList.length > 0) {
      const idx = issueList.findIndex((i) => i.id === selectedIdRef.current);
      if (idx >= 0) setSelectedIndex(idx);
    }
  }, [issueList, setSelectedIndex]);

  // Wire up keyboard shortcuts
  useKeyboardShortcuts(issueList);

  // When user clicks an issue, update the store index
  const handleSelect = (issue: { id: string }) => {
    const idx = issueList.findIndex((i) => i.id === issue.id);
    if (idx >= 0) setSelectedIndex(idx);
  };

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
              {issues.length} issue{issues.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <SyncStatus />
      </div>

      {/* Split pane */}
      <ResizablePanelGroup orientation="horizontal" className="flex-1">
        <ResizablePanel defaultSize={40} minSize={25}>
          <IssueList
            issues={issueList}
            selectedIndex={selectedIndex}
            onSelect={handleSelect}
            isLoading={isLoading}
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
