/**
 * @module inbox/use-issue-filter
 *
 * Persists the selected inbox view filter in localStorage so the choice
 * survives reloads without requiring a server round trip.
 */
"use client";

import type { IssueFilter } from "./issue-filters";
import { ISSUE_FILTERS } from "./issue-filters";
import { useLocalStorageValue } from "./use-local-storage-value";

const STORAGE_KEY = "snaptriage:issue-filter";

function isIssueFilter(value: string | null): value is IssueFilter {
  return value !== null && ISSUE_FILTERS.some((option) => option.value === value);
}

export function useIssueFilter(): [IssueFilter, (next: IssueFilter) => void] {
  return useLocalStorageValue<IssueFilter>(STORAGE_KEY, "all", (stored) =>
    isIssueFilter(stored) ? stored : "all"
  );
}
