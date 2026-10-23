/**
 * @module features/landing/components/triage-demo
 *
 * The landing page hero: a working slice of the SnapTriage inbox.
 *
 * It is not a screenshot. The queue is live, the same keys work here as in
 * the app, and the selection indicator travels between rows on a spring, so
 * a visitor can try the product before deciding to sign in.
 */
"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { GitHubIcon } from "@/components/icons/github-icon";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import { Kbd } from "@/features/keyboard/components/kbd";
import { isEditableElement } from "@/features/keyboard/is-editable-element";
import { priorityLabels } from "@/features/triage/priority";
import { devIssues, useDataMode, type DataMode } from "@/features/dev-tools/data-mode";
import { cn, formatRelativeTime } from "@/lib/utils";
import { useSpringNumber } from "../use-spring";

/** One issue in the demo queue. */
interface DemoIssue {
  /** Stable key for React. */
  id: string;
  /** Issue number as the provider shows it. */
  number: number;
  /** Issue title. */
  title: string;
  /** `owner/name` of the repository the issue belongs to. */
  repo: string;
  /** Provider the issue came from. */
  provider: "github" | "gitlab";
  /** Provider labels. */
  labels: string[];
  /** When the issue was last touched. */
  updatedAt: string;
  /** Priority 0-3, or `null` when the issue has none. */
  priority: number | null;
  /** Whether the issue has been dismissed. */
  dismissed: boolean;
}

/** ISO timestamp `hours` in the past, for the demo rows. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

/** A change that the demo can take back. */
interface UndoAction {
  /** Index of the issue that was changed. */
  index: number;
  /** Priority the issue had before the change. */
  priority: number | null;
  /** Dismissed flag the issue had before the change. */
  dismissed: boolean;
}

/** The demo queue. */
const DEMO_ISSUES: DemoIssue[] = [
  {
    id: "snap-412",
    number: 412,
    title: "Crash on startup when the config file is missing",
    repo: "chiranjeevi-max/SnapTriage",
    provider: "github",
    labels: ["bug"],
    updatedAt: hoursAgo(2),
    priority: 1,
    dismissed: false,
  },
  {
    id: "ds-1187",
    number: 1187,
    title: "Add bulk rename for labels",
    repo: "acme/design-system",
    provider: "github",
    labels: ["enhancement", "component"],
    updatedAt: hoursAgo(4),
    priority: null,
    dismissed: false,
  },
  {
    id: "console-63",
    number: 63,
    title: "500 from /api/issues for archived repositories",
    repo: "acme/console",
    provider: "github",
    labels: ["bug"],
    updatedAt: hoursAgo(6),
    priority: 0,
    dismissed: false,
  },
  {
    id: "console-27",
    number: 27,
    title: "Support GitLab subgroups in the repository picker",
    repo: "acme/console",
    provider: "gitlab",
    labels: ["feature"],
    updatedAt: hoursAgo(26),
    priority: null,
    dismissed: false,
  },
  {
    id: "api-904",
    number: 904,
    title: "Keyboard overlay overlaps the sidebar on small screens",
    repo: "northwind/api",
    provider: "github",
    labels: ["bug", "ui"],
    updatedAt: hoursAgo(26),
    priority: 2,
    dismissed: false,
  },
  {
    id: "api-151",
    number: 151,
    title: "Document the batch push workflow",
    repo: "northwind/api",
    provider: "gitlab",
    labels: ["docs"],
    updatedAt: hoursAgo(50),
    priority: null,
    dismissed: false,
  },
  {
    id: "console-88",
    number: 88,
    title: "Flaky test: sync engine retries on a 429",
    repo: "acme/console",
    provider: "github",
    labels: ["test"],
    updatedAt: hoursAgo(72),
    priority: 3,
    dismissed: false,
  },
];

/** Keys shown in the demo header. */
const HINTS: { keys: string[]; label: string }[] = [
  { keys: ["J", "K"], label: "move" },
  { keys: ["1–4"], label: "priority" },
  { keys: ["D"], label: "dismiss" },
  { keys: ["Z"], label: "undo" },
];

/** Rows the demo draws. The rest of the queue is counted, not rendered. */
/** How many label chips a demo row shows before it counts the rest. */
const MAX_VISIBLE_LABELS = 3;

/**
 * How many rows the demo renders.
 *
 * The queue is an illustration, not the product's list: a real queue can hold
 * thousands of issues, and rendering them all would make the landing page
 * tens of thousands of pixels tall. The header says how many are shown.
 */
const MAX_VISIBLE_ROWS = 10;

/** One line describing what is in the queue. */
function queueSummary(issues: DemoIssue[]): string {
  const repositories = new Set(issues.map((issue) => issue.repo)).size;
  return `${countOf(issues.length, "open issue")} across ${countOf(
    repositories,
    "repository",
    "repositories"
  )}`;
}

/**
 * Formats a count with its noun, pluralised by the English rules.
 *
 * @param count - The number to format.
 * @param singular - The noun in its singular form.
 * @param plural - The noun in its plural form, when it is not just `singular + "s"`.
 * @returns The count and the correctly pluralised noun.
 */
function countOf(count: number, singular: string, plural = `${singular}s`): string {
  const noun = PLURALS.select(count) === "one" ? singular : plural;
  return `${NUMBER_FORMAT.format(count)} ${noun}`;
}

/** Formats numbers for display. */
const NUMBER_FORMAT = new Intl.NumberFormat("en");

/** Decides between singular and plural nouns. */
const PLURALS = new Intl.PluralRules("en");

/**
 * Live triage queue shown in the hero.
 *
 * Keys work the moment the page loads: `J`/`K` move the selection, `1`-`4`
 * set the priority, `D` dismisses, `Z` takes the last change back. Clicking a
 * row selects it, so the demo is usable with a mouse too.
 */
export function TriageDemo() {
  const mode = useDataMode();
  // Keying on the dataset restarts the queue when the dev toggle swaps it.
  return <TriageQueue key={mode} mode={mode} />;
}

/** The queue itself. Remounted whenever the dataset changes. */
function TriageQueue({ mode }: { mode: DataMode }) {
  const [issues, setIssues] = useState<DemoIssue[]>(DEMO_ISSUES);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [status, setStatus] = useState(queueSummary(DEMO_ISSUES));
  const [canUndo, setCanUndo] = useState(false);
  const [indicator, setIndicator] = useState<{ y: number; height: number } | null>(null);
  const [initialY, setInitialY] = useState<number | null>(null);

  // The dev-only data toggle swaps the queue for the worst case.
  useEffect(() => {
    let active = true;
    devIssues(mode).then((fixture) => {
      if (!active) return;
      const next = fixture
        ? fixture.map((issue): DemoIssue => ({
            id: issue.id,
            number: issue.number,
            title: issue.title,
            repo: issue.repo,
            provider: issue.provider === "gitlab" ? "gitlab" : "github",
            labels: issue.labels,
            updatedAt: issue.updatedAt,
            priority: issue.triage?.priority ?? null,
            dismissed: issue.triage?.dismissed ?? false,
          }))
        : DEMO_ISSUES;
      setIssues(next);
      setSelectedIndex(0);
      setCanUndo(false);
      setStatus(queueSummary(next));
    });
    return () => {
      active = false;
    };
  }, [mode]);

  const listRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const undoRef = useRef<UndoAction | null>(null);

  // The indicator sits behind the rows and is moved by a spring, so the
  // selection arrives with the same weight the app gives it.
  useSpringNumber(indicator?.y ?? null, {
    response: 0.28,
    damping: 1,
    initialValue: initialY ?? undefined,
    onFrame: (value) => {
      const element = indicatorRef.current;
      if (element) element.style.transform = `translate3d(0, ${value.toFixed(2)}px, 0)`;
    },
  });

  // Measure the selected row so the indicator can travel to it.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLElement>(`[data-issue-index="${selectedIndex}"]`);
    if (!row) return;
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    setIndicator({ y: rowRect.top - listRect.top + list.scrollTop, height: rowRect.height });
  }, [selectedIndex]);

  // On first paint the indicator starts at the bottom of the queue and rides
  // up to the first row, so the queue reads as live rather than as a picture.
  useLayoutEffect(() => {
    if (initialY !== null) return;
    const list = listRef.current;
    if (!list) return;
    const rows = list.querySelectorAll<HTMLElement>("[data-issue-index]");
    const last = rows[rows.length - 1];
    if (!last) return;
    const listRect = list.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    setInitialY(lastRect.top - listRect.top + list.scrollTop);
  }, [initialY]);

  const move = useCallback(
    (delta: number) => {
      setSelectedIndex((current) => {
        const next = current + delta;
        if (next < 0 || next >= issues.length) return current;
        return next;
      });
    },
    [issues.length]
  );

  const applyPriority = useCallback(
    (priority: number) => {
      const issue = issues[selectedIndex];
      if (!issue) return;
      // Pressing the same priority again clears it, the way the app does.
      const next = issue.priority === priority ? null : priority;
      undoRef.current = {
        index: selectedIndex,
        priority: issue.priority,
        dismissed: issue.dismissed,
      };
      setIssues((current) =>
        current.map((item, index) => (index === selectedIndex ? { ...item, priority: next } : item))
      );
      setStatus(
        next === null
          ? `Cleared priority · ${issue.repo}#${issue.number}`
          : `Set priority to P${next} · ${issue.repo}#${issue.number}`
      );
      setCanUndo(true);
    },
    [issues, selectedIndex]
  );

  const toggleDismiss = useCallback(() => {
    const issue = issues[selectedIndex];
    if (!issue) return;
    const next = !issue.dismissed;
    undoRef.current = {
      index: selectedIndex,
      priority: issue.priority,
      dismissed: issue.dismissed,
    };
    setIssues((current) =>
      current.map((item, index) => (index === selectedIndex ? { ...item, dismissed: next } : item))
    );
    setStatus(`${next ? "Dismissed" : "Undismissed"} issue · ${issue.repo}#${issue.number}`);
    setCanUndo(true);
  }, [issues, selectedIndex]);

  const undo = useCallback(() => {
    const action = undoRef.current;
    if (!action) return;
    undoRef.current = null;
    setIssues((current) =>
      current.map((item, index) =>
        index === action.index
          ? { ...item, priority: action.priority, dismissed: action.dismissed }
          : item
      )
    );
    setStatus("Undid last action");
    setCanUndo(false);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableElement(event.target)) return;

      switch (event.key.toLowerCase()) {
        case "j":
          move(1);
          break;
        case "k":
          move(-1);
          break;
        case "d":
          toggleDismiss();
          break;
        case "z":
          undo();
          break;
        case "1":
        case "2":
        case "3":
        case "4":
          applyPriority(Number(event.key) - 1);
          break;
      }
    },
    [move, toggleDismiss, undo, applyPriority]
  );

  // The handler is kept in a ref so the listener is attached once.
  const handlerRef = useRef(handleKeyDown);
  useEffect(() => {
    handlerRef.current = handleKeyDown;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handlerRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const visibleIssues = issues.slice(0, MAX_VISIBLE_ROWS);
  const hiddenIssueCount = issues.length - visibleIssues.length;

  return (
    <div className="overflow-hidden rounded-xl border bg-card/70 shadow-sm backdrop-blur-sm">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2.5">
        <p className="flex min-w-0 items-baseline gap-2 text-sm font-medium">
          <span className="shrink-0">Inbox</span>
          <span className="shrink-0 font-mono text-xs font-normal tabular-nums text-muted-foreground">
            {NUMBER_FORMAT.format(issues.length)} open
          </span>
          {hiddenIssueCount > 0 && (
            <span className="truncate font-mono text-[11px] font-normal text-muted-foreground/80">
              showing first {visibleIssues.length}
            </span>
          )}
        </p>
        <div className="hidden items-center gap-4 text-[11px] text-muted-foreground sm:flex">
          {HINTS.map((hint) => (
            <span key={hint.label} className="flex items-center gap-1.5">
              {hint.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
              {hint.label}
            </span>
          ))}
        </div>
      </div>

      <div
        ref={listRef}
        role="listbox"
        tabIndex={0}
        aria-label="SnapTriage inbox demo"
        aria-activedescendant={`demo-option-${selectedIndex}`}
        className="relative rounded-md p-1.5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/60"
      >
        <div
          ref={indicatorRef}
          aria-hidden="true"
          className="absolute left-1.5 right-1.5 top-0 rounded-md bg-accent"
          style={{ height: indicator?.height ?? 0 }}
        />
        {visibleIssues.map((issue, index) => {
          const selected = index === selectedIndex;
          const priority = issue.priority === null ? null : priorityLabels[issue.priority];
          const shownLabels = issue.labels.slice(0, MAX_VISIBLE_LABELS);
          const hiddenLabels = issue.labels.length - shownLabels.length;
          return (
            <button
              key={issue.id}
              type="button"
              role="option"
              id={`demo-option-${index}`}
              tabIndex={-1}
              aria-selected={selected}
              data-issue-index={index}
              onClick={() => setSelectedIndex(index)}
              className={cn(
                "relative flex h-12 w-full min-w-0 items-center gap-3 rounded-md px-2.5 text-start transition-colors",
                selected ? "text-foreground" : "text-foreground/75 hover:bg-accent/40",
                issue.dismissed && "opacity-40"
              )}
            >
              <span className="w-8 shrink-0">
                {priority && (
                  <Badge
                    variant="outline"
                    className={cn("px-1.5 py-0 text-[10px] leading-4", priority.className)}
                  >
                    {priority.label}
                  </Badge>
                )}
              </span>

              <span
                title={issue.title}
                className={cn(
                  // The floor keeps the title readable when every other field
                  // in the row is at its cap; the caps elsewhere guarantee the
                  // row can still fit it.
                  "min-w-[10rem] flex-1 truncate text-sm",
                  issue.dismissed && "line-through"
                )}
              >
                {issue.title}
              </span>

              {issue.labels.length > 0 && (
                <span className="hidden min-w-0 shrink items-center gap-1 overflow-hidden lg:flex">
                  {shownLabels.map((label) => (
                    <span
                      key={label}
                      title={label}
                      className="max-w-[8rem] shrink-0 truncate rounded border px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                    >
                      {label}
                    </span>
                  ))}
                  {hiddenLabels > 0 && (
                    <span className="shrink-0 rounded border px-1.5 py-px font-mono text-[10px] tabular-nums text-muted-foreground/80">
                      +{hiddenLabels}
                    </span>
                  )}
                </span>
              )}

              <span className="hidden shrink-0 items-center gap-1.5 font-mono text-xs text-muted-foreground sm:flex">
                {issue.provider === "github" ? (
                  <GitHubIcon className="h-3.5 w-3.5" />
                ) : (
                  <GitLabIcon className="h-3.5 w-3.5" />
                )}
                <span title={issue.repo} className="max-w-[10rem] truncate">
                  {issue.repo}
                </span>
                <span className="tabular-nums">#{issue.number}</span>
              </span>

              <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                {formatRelativeTime(issue.updatedAt)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5">
        <p role="status" className="truncate font-mono text-[11px] text-muted-foreground">
          {status}
        </p>
        {canUndo && (
          <p className="shrink-0 font-mono text-[11px] text-muted-foreground">press Z to undo</p>
        )}
      </div>
    </div>
  );
}
