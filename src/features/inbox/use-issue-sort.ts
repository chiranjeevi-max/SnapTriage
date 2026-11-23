/**
 * @module inbox/use-issue-sort
 *
 * Persists the queue's sort order in localStorage, mirroring {@link useIssueFilter}.
 */
"use client";

import { useState } from "react";
import { isIssueSort, type IssueSort } from "./issue-sort";

const STORAGE_KEY = "snaptriage:issue-sort";

export function useIssueSort(): [IssueSort, (next: IssueSort) => void] {
  const [sort, setSort] = useState<IssueSort>(() => {
    if (typeof window === "undefined") return "updated";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isIssueSort(stored) ? stored : "updated";
  });

  const update = (next: IssueSort) => {
    setSort(next);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  };

  return [sort, update];
}
