/**
 * @module inbox/use-issue-query
 *
 * Persists the inbox query text in localStorage, mirroring {@link useIssueFilter}
 * so the box does not empty itself on every reload.
 */
"use client";

import { useMemo, useState } from "react";
import { parseQuery, type IssueQuery } from "./issue-query";

const STORAGE_KEY = "snaptriage:issue-query";

export function useIssueQuery(): [string, (next: string) => void, IssueQuery] {
  const [text, setText] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  });

  const update = (next: string) => {
    setText(next);
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, next);
  };

  // Parsed once per keystroke rather than once per row: the box re-renders on
  // every character, and a per-row parse would rebuild the same object N times.
  const query = useMemo(() => parseQuery(text), [text]);

  return [text, update, query];
}
