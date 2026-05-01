## 2024-05-01 - Issue List Re-renders
**Learning:** `IssueRow` in `src/features/inbox/components/issue-list.tsx` is rendering on every selection change, even for rows that aren't selected or deselected. This is because `IssueRow` is an inline component in `IssueList` and not memoized, and `onSelect` creates a new function reference on every render.
**Action:** Use `React.memo` to wrap list item components when they are part of a larger list and their re-renders could cause performance issues. Also use `useCallback` for functions passed as props to memoized components.
