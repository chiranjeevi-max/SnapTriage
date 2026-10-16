/**
 * @module inbox/use-issue-filter
 *
 * Persists the selected inbox view filter in localStorage so the choice
 * survives reloads without requiring a server round trip.
 */
"use client";

import { useState } from "react";
import type { IssueFilter } from "./issue-filters";
import { ISSUE_FILTERS } from "./issue-filters";

const STORAGE_KEY = "snaptriage:issue-filter";

function isIssueFilter(value: string | null): value is IssueFilter {
  return value !== null && ISSUE_FILTERS.some((option) => option.value === value);
}

export function useIssueFilter(): [IssueFilter, (next: IssueFilter) => void] {
  const [filter, setFilter] = useState<IssueFilter>(() => {
    if (typeof window === "undefined") return "all";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isIssueFilter(stored) ? stored : "all";
  });

  const update = (next: IssueFilter) => {
    setFilter(next);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  };

  return [filter, update];
}
