/**
 * @module inbox/use-issue-sort
 *
 * Persists the queue's sort order in localStorage, mirroring {@link useIssueFilter}.
 */
"use client";

import { isIssueSort, type IssueSort } from "./issue-sort";
import { useLocalStorageValue } from "./use-local-storage-value";

const STORAGE_KEY = "snaptriage:issue-sort";

export function useIssueSort(): [IssueSort, (next: IssueSort) => void] {
  return useLocalStorageValue<IssueSort>(STORAGE_KEY, "updated", (stored) =>
    isIssueSort(stored) ? stored : "updated"
  );
}
