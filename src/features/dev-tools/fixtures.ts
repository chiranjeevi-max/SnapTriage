/**
 * @module features/dev-tools/fixtures
 *
 * Worst-case data for the dev-only data toggle.
 *
 * Every value here is either a realistic example or the documented limit of
 * the field it stands in for, so each break it causes is one a real user could
 * hit. The limits are listed per row.
 */
import type { IssueDetail } from "@/features/inbox/use-issues";
import type { DataMode } from "./data-mode";

/** A repository as the app stores it. */
export interface FixtureRepo {
  id: string;
  provider: "github" | "gitlab";
  owner: string;
  name: string;
  fullName: string;
  permission: "admin" | "write" | "read";
  syncEnabled: boolean;
  syncMode: "live" | "batch";
}

/** An issue plus the repository name the landing demo renders. */
export interface FixtureIssue extends IssueDetail {
  /** `owner/name` of the repository the issue belongs to. */
  repo: string;
}

/** A connected account as the settings page renders it. */
export interface FixtureAccount {
  provider: "github" | "gitlab";
  providerAccountId: string;
  type: "oauth" | "pat";
}

/** A repository the user could connect, as the repo browser renders it. */
export interface FixtureAvailableRepo {
  provider: "github" | "gitlab";
  owner: string;
  name: string;
  fullName: string;
  description: string | null;
  permission: "admin" | "write" | "read";
  isPrivate: boolean;
}

/** A saved view as the inbox toolbar renders it. */
export interface FixtureView {
  id: string;
  userId: string;
  name: string;
  filter: "all" | "open" | "dismissed" | "snoozed" | "urgent";
  createdAt: string;
  updatedAt: string;
}

const HOUR = 3600_000;

/** ISO timestamp `hours` in the past. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR).toISOString();
}

/** GitHub's hard limit on an issue title. */
const TITLE_LIMIT = 256;

/** GitHub's hard limit on a label name. */
const LABEL_LIMIT = 50;

/** GitHub's hard limit on a login. */
const LOGIN_LIMIT = 39;

/** GitHub's hard limit on labels per issue. */
const MAX_LABELS = 100;

/** GitHub's hard limit on an issue body. */
const BODY_LIMIT = 65_536;

/** A title at the provider's limit, made of real words. */
const LONG_TITLE =
  "Flaky integration suite fails intermittently on CI when the upstream provider answers with a " +
  "rate limit and the retry backoff never runs, so the whole matrix is re-run from scratch and the " +
  "job is eventually killed after six hours of waiting for a green result that never arrives";

/** A title with a long unbreakable URL in it. */
const URL_TITLE =
  "Webhook rejects payloads that contain a long URL such as " +
  "https://api.github.com/repos/northwind-industries-holdings/customer-identity-platform/hooks/9876543210";

/** A title in Vietnamese and Thai: diacritics and a tall script. */
const DIACRITIC_TITLE =
  "Không hiển thị được tiếng Việt có dấu vàการจัดวางปุ่มภาษาไทยบนหน้าจอเล็กที่มีความสูงจำกัด";

/** A title that is one long word with no break opportunity. */
const LONG_WORD_TITLE =
  "Supercalifragilisticexpialidociousflabiodoodlehousenomenalitarianismantidisestablishmentarianism" +
  "pneumonoultramicroscopicsilicovolcanoconiosis";

/** A body at the provider's limit: a real issue log, padded to the cap. */
function longBody(): string {
  const block = [
    "## Steps to reproduce",
    "",
    "1. Sign in with a personal access token.",
    "2. Open the inbox with more than five hundred open issues.",
    "3. Press `1` to set the priority, then `l` to edit labels.",
    "",
    "```",
    "Error: Request failed with status code 403",
    "    at throwIfError (node_modules/.pnpm/kysely@0.27.4/node_modules/kysely/dist/esm/query-builder/select-query-builder.js:41:13)",
    "    at processTicksAndRejections (node:internal/process/task_queues:95:5)",
    "```",
    "",
    "| Provider | Repo | Issues |",
    "| --- | --- | --- |",
    "| GitHub | northwind-industries-holdings/customer-identity-platform | 1284 |",
    "",
  ].join("\n");

  let body = "";
  while (body.length + block.length <= BODY_LIMIT) body += block;
  return body.padEnd(BODY_LIMIT, "\n");
}

/** Ten assignees, the most a GitHub issue can carry. */
const MAX_ASSIGNEES_LIST = [
  "bartholomew.fitzgerald",
  "jo",
  "averylongusernamehere1234567890",
  "nadia",
  "r.okonkwo",
  "sven",
  "priya-ramachandran",
  "t",
  "maria.dimitrova",
  "vladimir",
];

/** A hundred labels, the most a GitHub issue can carry. */
const MAX_LABELS_LIST = Array.from({ length: MAX_LABELS }, (_, index) =>
  index === 0
    ? "documentation-must-be-updated-and-reviewed-before-merge" // LABEL_LIMIT
    : `label-number-${String(index).padStart(2, "0")}`
);

function issue(
  overrides: Partial<FixtureIssue> & { id: string; number: number; title: string; repo: string }
): FixtureIssue {
  return {
    repoId: "r1",
    provider: "github",
    body: null,
    author: "chiranjeevi",
    authorAvatar: null,
    state: "open",
    labels: [],
    assignees: [],
    url: "https://github.com/example/example/issues/1",
    providerIssueId: "1",
    createdAt: hoursAgo(48),
    updatedAt: hoursAgo(2),
    fetchedAt: new Date().toISOString(),
    triage: { id: "t", priority: null, snoozedUntil: null, dismissed: false },
    ...overrides,
  };
}

/**
 * The worst case for one queue.
 *
 * Each row carries a different failure so the first screen shows all of them:
 * a title at the provider limit, an unbreakable URL, a missing author, a
 * hundred labels, a tall script, an emoji, a single long word, and a body at
 * the provider's size limit.
 */
export const WORST_CASE_ISSUES: FixtureIssue[] = [
  issue({
    id: "worst-1",
    number: 999_999,
    title: LONG_TITLE.slice(0, TITLE_LIMIT),
    repo: "northwind-industries-holdings/customer-identity-platform",
    author: "bartholomew.fitzgerald-northwind".slice(0, LOGIN_LIMIT),
    labels: [
      "documentation-must-be-updated-and-reviewed-before-merge".slice(0, LABEL_LIMIT),
      "priorité-haute",
      "needs-repro",
    ],
    assignees: MAX_ASSIGNEES_LIST,
    body: longBody(),
    updatedAt: hoursAgo(0.02),
    triage: { id: "t1", priority: 1, snoozedUntil: null, dismissed: false },
  }),
  issue({
    id: "worst-2",
    number: 1,
    title: URL_TITLE,
    repo: "a/b",
    author: null,
    authorAvatar: null,
    labels: [],
    updatedAt: hoursAgo(1),
    triage: { id: "t2", priority: null, snoozedUntil: null, dismissed: false },
  }),
  issue({
    id: "worst-3",
    number: 4200,
    title: "Every label at once",
    repo: "group/subgroup/project-with-a-long-name",
    provider: "gitlab",
    labels: MAX_LABELS_LIST,
    assignees: ["jo", "nadia"],
    updatedAt: hoursAgo(3),
    triage: { id: "t3", priority: 0, snoozedUntil: null, dismissed: false },
  }),
  issue({
    id: "worst-4",
    number: 7,
    title: DIACRITIC_TITLE,
    repo: "acme/console",
    labels: ["ui", "typography"],
    updatedAt: hoursAgo(26),
    triage: { id: "t4", priority: 2, snoozedUntil: null, dismissed: false },
  }),
  issue({
    id: "worst-5",
    number: 8,
    title: "🎉 Ship the new triage queue to everyone at once",
    repo: "acme/console",
    author: "jo",
    updatedAt: hoursAgo(30),
    triage: { id: "t5", priority: null, snoozedUntil: null, dismissed: true },
  }),
  issue({
    id: "worst-6",
    number: 9,
    title: LONG_WORD_TITLE,
    repo: "northwind/api",
    author: "r.okonkwo",
    updatedAt: hoursAgo(50),
    triage: { id: "t6", priority: 3, snoozedUntil: null, dismissed: false },
  }),
  issue({
    id: "worst-7",
    number: 10,
    title: "Fix",
    repo: "acme/console",
    body: "Nothing to add.",
    updatedAt: hoursAgo(72),
    triage: { id: "t7", priority: null, snoozedUntil: null, dismissed: false },
  }),
];

/** Repositories at the limits the app's own API allows. */
export const WORST_CASE_REPOS: FixtureRepo[] = [
  {
    id: "r1",
    provider: "gitlab",
    owner: "group/subgroup/second-subgroup",
    name: "project-with-a-very-long-name-that-keeps-going-and-going",
    fullName:
      "group/subgroup/second-subgroup/project-with-a-very-long-name-that-keeps-going-and-going",
    permission: "admin",
    syncEnabled: true,
    syncMode: "live",
  },
  {
    id: "r2",
    provider: "github",
    owner: "a-very-long-organization-name-that-keeps-on-going",
    name: "and-an-extremely-long-repository-name-that-keeps-going",
    fullName:
      "a-very-long-organization-name-that-keeps-on-going/and-an-extremely-long-repository-name-that-keeps-going",
    permission: "write",
    syncEnabled: true,
    syncMode: "batch",
  },
  {
    id: "r3",
    provider: "github",
    owner: "a",
    name: "b",
    fullName: "a/b",
    permission: "read",
    syncEnabled: false,
    syncMode: "batch",
  },
];

/** Accounts as the settings page renders them. */
export const WORST_CASE_ACCOUNTS: FixtureAccount[] = [
  { provider: "github", providerAccountId: "12345678", type: "oauth" },
  { provider: "gitlab", providerAccountId: "999999", type: "pat" },
];

/** Repositories the browser offers, with a description at the provider's limit. */
export const WORST_CASE_AVAILABLE_REPOS: FixtureAvailableRepo[] = [
  {
    provider: "gitlab",
    owner: "group/subgroup/second-subgroup",
    name: "project-with-a-very-long-name-that-keeps-going-and-going",
    fullName:
      "group/subgroup/second-subgroup/project-with-a-very-long-name-that-keeps-going-and-going",
    description:
      "A service that handles identity for every customer in the group, including the parts that " +
      "only exist for enterprise contracts and the migrations that are still in flight.",
    permission: "admin",
    isPrivate: true,
  },
  {
    provider: "github",
    owner: "a-very-long-organization-name-that-keeps-on-going",
    name: "and-an-extremely-long-repository-name-that-keeps-going",
    fullName:
      "a-very-long-organization-name-that-keeps-on-going/and-an-extremely-long-repository-name-that-keeps-going",
    description: null,
    permission: "read",
    isPrivate: false,
  },
  {
    provider: "github",
    owner: "a",
    name: "b",
    fullName: "a/b",
    description: "",
    permission: "read",
    isPrivate: false,
  },
];

/** A saved view with a name at the API's 80 character limit. */
export const WORST_CASE_VIEWS: FixtureView[] = [
  {
    id: "v1",
    userId: "u1",
    name: "Everything that is not dismissed and still needs a decision from somebody",
    filter: "open",
    createdAt: hoursAgo(24),
    updatedAt: hoursAgo(24),
  },
  {
    id: "v2",
    userId: "u1",
    name: "Snoozed",
    filter: "snoozed",
    createdAt: hoursAgo(24),
    updatedAt: hoursAgo(24),
  },
];

/** A thousand rows, for the list performance and pagination check. */
export function manyIssues(count = 1000): FixtureIssue[] {
  return Array.from({ length: count }, (_, index) =>
    issue({
      id: `many-${index}`,
      number: index + 1,
      title: `${index + 1}. ${LONG_TITLE.slice(0, TITLE_LIMIT - String(index + 1).length - 2)}`,
      repo: WORST_CASE_REPOS[index % WORST_CASE_REPOS.length].fullName,
      labels: MAX_LABELS_LIST.slice(0, 3),
      updatedAt: hoursAgo(index % 72),
      triage: {
        id: `t-${index}`,
        priority: index % 4,
        snoozedUntil: null,
        dismissed: false,
      },
    })
  );
}

/**
 * The issues for a mode.
 *
 * @param mode - The active data mode.
 * @returns The issues the mode stands for.
 */
export function issuesForMode(mode: DataMode): FixtureIssue[] {
  if (mode === "empty") return [];
  if (mode === "one") return WORST_CASE_ISSUES.slice(0, 1);
  if (mode === "many") return manyIssues();
  return WORST_CASE_ISSUES;
}

/**
 * The repositories for a mode.
 *
 * @param mode - The active data mode.
 * @returns The repositories the mode stands for.
 */
export function reposForMode(mode: DataMode): FixtureRepo[] {
  if (mode === "empty") return [];
  if (mode === "one") return WORST_CASE_REPOS.slice(0, 1);
  return WORST_CASE_REPOS;
}

/**
 * The accounts for a mode.
 *
 * @param mode - The active data mode.
 * @returns The accounts the mode stands for.
 */
export function accountsForMode(mode: DataMode): FixtureAccount[] {
  if (mode === "empty") return [];
  if (mode === "one") return WORST_CASE_ACCOUNTS.slice(0, 1);
  return WORST_CASE_ACCOUNTS;
}

/**
 * The browsable repositories for a mode.
 *
 * @param mode - The active data mode.
 * @returns The repositories the mode stands for.
 */
export function availableReposForMode(mode: DataMode): FixtureAvailableRepo[] {
  if (mode === "empty") return [];
  if (mode === "one") return WORST_CASE_AVAILABLE_REPOS.slice(0, 1);
  return WORST_CASE_AVAILABLE_REPOS;
}

/**
 * The saved views for a mode.
 *
 * @param mode - The active data mode.
 * @returns The views the mode stands for.
 */
export function viewsForMode(mode: DataMode): FixtureView[] {
  if (mode === "empty") return [];
  if (mode === "one") return WORST_CASE_VIEWS.slice(0, 1);
  return WORST_CASE_VIEWS;
}
