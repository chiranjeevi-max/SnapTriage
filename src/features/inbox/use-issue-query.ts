/**
 * @module inbox/use-issue-query
 *
 * Persists the inbox query text in localStorage, mirroring {@link useIssueFilter}
 * so the box does not empty itself on every reload.
 */
"use client";

import { useMemo } from "react";
import { parseQuery, type IssueQuery } from "./issue-query";
import { useLocalStorageValue } from "./use-local-storage-value";

const STORAGE_KEY = "snaptriage:issue-query";

export function useIssueQuery(): [string, (next: string) => void, IssueQuery] {
  const [text, setText] = useLocalStorageValue<string>(STORAGE_KEY, "", (stored) => stored ?? "");

  // Parsed once per keystroke rather than once per row: the box re-renders on
  // every character, and a per-row parse would rebuild the same object N times.
  const query = useMemo(() => parseQuery(text), [text]);

  return [text, setText, query];
}
