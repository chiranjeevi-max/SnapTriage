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
import type { Preset } from "@/features/presets/types";
import type { ReplyComment, SavedReply } from "@/features/replies/use-replies";
import type { FollowUpEntry, FollowUpList } from "@/features/follow-up/use-follow-ups";
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

/** A preset as the picker renders it. */
export type FixturePreset = Preset;

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

/** A preset name at the API's 80 character limit, made of real words. */
const LONG_PRESET_NAME =
  "Confirmed bug: 500 on every checkout retry, charged twice, no audit trail in log";

/**
 * The worst case for the preset picker.
 *
 * Each row breaks a different thing so one screen shows all of them: a name at
 * the 80 character limit, a label at GitHub's 50 character label limit, a
 * hundred labels, a preset whose every action the worst-case issue already
 * satisfies, and an empty bundle the picker must refuse to render.
 */
export const WORST_CASE_PRESETS: Preset[] = [
  {
    id: "preset-1",
    repoId: "r1",
    name: LONG_PRESET_NAME,
    actions: {
      priority: 1,
      labels: {
        add: [
          "documentation-must-be-updated-and-reviewed-before-merge".slice(0, LABEL_LIMIT),
          "confirmed",
          "needs-repro",
        ],
      },
      assignees: { add: ["jo"] },
    },
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(2),
  },
  {
    id: "preset-2",
    repoId: "r1",
    name: "Every label",
    actions: {
      labels: { add: MAX_LABELS_LIST },
    },
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(4),
  },
  {
    id: "preset-3",
    // Every value here is already on worst-1, so resolving it is a no-op. That
    // is the row that proves the pane says "Already applied" instead of
    // reporting a success it did not perform.
    repoId: "r1",
    name: "Already satisfied by the first row",
    actions: {
      priority: 1,
      labels: {
        add: ["documentation-must-be-updated-and-reviewed-before-merge".slice(0, LABEL_LIMIT)],
      },
      assignees: { add: [MAX_ASSIGNEES_LIST[0]] },
    },
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(6),
  },
  {
    id: "preset-4",
    repoId: "r1",
    name: "Empty bundle from before validation existed",
    actions: {},
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(8),
  },
  {
    id: "preset-5",
    repoId: "r1",
    name: "Clear priority",
    actions: { priority: null, labels: { add: ["priorité-haute"] } },
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(10),
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
      repoId: WORST_CASE_REPOS[index % WORST_CASE_REPOS.length].id,
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

/**
 * The presets for a mode.
 *
 * @param mode - The active data mode.
 * @returns The presets the mode stands for.
 */
export function presetsForMode(mode: DataMode): Preset[] {
  if (mode === "empty") return [];
  if (mode === "one") return WORST_CASE_PRESETS.slice(0, 1);
  return WORST_CASE_PRESETS;
}

/**
 * A comment body padded to exactly `limit` characters.
 *
 * Padded rather than truncated from one long sentence so the counter in the
 * composer is exercised at the boundary the provider actually enforces, and so
 * a body that reflows badly at that width is visible instead of theoretical.
 *
 * @param limit - The provider's documented comment limit, in characters.
 */
function commentAtLimit(limit: number): string {
  const block = [
    "Thanks for the report. Reproduced on `main` at 4f21c0e with the retry path enabled.",
    "",
    "```",
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "    at settle (src/lib/github/client.ts:118:22)",
    "```",
    "",
    "| Attempt | Status | Duration |",
    "| --- | --- | --- |",
    "| 1 | 503 | 30s |",
    "",
  ].join("\n");

  let body = "";
  while (body.length + block.length <= limit) body += block;
  return body.padEnd(limit, ".");
}

/** A thousand comments, for the pagination and scroll check on a long thread. */
export function manyComments(count = 1000): ReplyComment[] {
  return Array.from({ length: count }, (_, index) => ({
    id: String(1_000_000 + index),
    body:
      index % 12 === 0
        ? `**Comment ${index + 1}.** Re-ran the suite on node 26 and it is still flaky.`
        : `Comment ${index + 1}. Same here on macOS, but only under load.`,
    author:
      index % 5 === 0 ? "nadia" : index % 7 === 0 ? "dependabot[bot]" : "bartholomew.fitzgerald",
    authorAvatar: null,
    createdAt: hoursAgo(240 - index / 5),
    updatedAt: hoursAgo(240 - index / 5),
    isSystem: index % 23 === 0,
    url: `https://github.com/example/example/issues/1#issuecomment-${1_000_000 + index}`,
  }));
}

/**
 * The worst case for the discussion pane.
 *
 * One row per failure the pane has to survive: a body at GitHub's 65,536
 * character limit, a body at GitLab's 1,000,000 character limit, a provider
 * system note, a bot, the signed-in user's own reply, an unbreakable URL, and
 * mixed scripts. The system note and the bot are here because the follow-up
 * check has to tell them apart from a human reply; the pane has to render them
 * without pretending they are one.
 */
export const WORST_CASE_COMMENTS: ReplyComment[] = [
  {
    id: "9007199254740993",
    body: commentAtLimit(65_536),
    author: "bartholomew.fitzgerald-northwind".slice(0, LOGIN_LIMIT),
    authorAvatar: null,
    createdAt: hoursAgo(96),
    updatedAt: hoursAgo(96),
    isSystem: false,
    url: "https://github.com/example/example/issues/1#issuecomment-9007199254740993",
  },
  {
    id: "9007199254740994",
    body: commentAtLimit(1_000_000),
    author: "priya-ramachandran",
    authorAvatar: null,
    createdAt: hoursAgo(72),
    updatedAt: hoursAgo(72),
    isSystem: false,
    url: "https://gitlab.com/group/project/-/issues/1#note_9007199254740994",
  },
  {
    id: "9007199254740995",
    body: "added label ~confirmed and removed label ~needs-repro",
    author: "ghost",
    authorAvatar: null,
    createdAt: hoursAgo(60),
    updatedAt: hoursAgo(60),
    isSystem: true,
    url: null,
  },
  {
    id: "9007199254740996",
    body: "This issue has been automatically marked as stale because it has not had recent activity.",
    author: "stale[bot]",
    authorAvatar: null,
    createdAt: hoursAgo(48),
    updatedAt: hoursAgo(48),
    isSystem: false,
    url: "https://github.com/example/example/issues/1#issuecomment-9007199254740996",
  },
  {
    id: "9007199254740997",
    body: "Thanks, I can reproduce this on the retry path. Leaving it open for now.",
    author: "chiranjeevi",
    authorAvatar: null,
    createdAt: hoursAgo(30),
    updatedAt: hoursAgo(30),
    isSystem: false,
    url: "https://github.com/example/example/issues/1#issuecomment-9007199254740997",
  },
  {
    id: "9007199254740998",
    body:
      "The failing redirect lands on a URL with no break opportunity: " +
      "https://ci.northwind-industries-holdings.internal/pipelines/9876543210/jobs/1234567890/artifacts/bundle/coverage/lcov-report/src/features/very/deeply/nested/module/index.html#L9876",
    author: "r.okonkwo",
    authorAvatar: null,
    createdAt: hoursAgo(12),
    updatedAt: hoursAgo(12),
    isSystem: false,
    url: "https://github.com/example/example/issues/1#issuecomment-9007199254740998",
  },
  {
    id: "9007199254740999",
    body:
      "同じ現象を確認しました。การจัดวางปุ่มภาษาไทยบนหน้าจอเล็กที่มีความสูงจำกัดก็พังด้วย " +
      "Không hiển thị được tiếng Việt có dấu khi bảng có nhiều cột.",
    author: "jo",
    authorAvatar: null,
    createdAt: hoursAgo(4),
    updatedAt: hoursAgo(4),
    isSystem: false,
    url: "https://github.com/example/example/issues/1#issuecomment-9007199254740999",
  },
  {
    id: "9007199254741000",
    body: "",
    author: null,
    authorAvatar: null,
    createdAt: hoursAgo(2),
    updatedAt: hoursAgo(2),
    isSystem: false,
    url: null,
  },
];

/**
 * The worst case for the follow-up queue.
 *
 * The first row has never been checked, so the view has to say so instead of
 * rendering an empty `checked  ago`. The second carries a three-day-old check,
 * which is the state freshness text exists for. The remaining rows cover each
 * state and both reasons, and one row is simultaneously snoozed and waiting on
 * a follow-up: the two are separate concepts and neither clears the other.
 */
export const WORST_CASE_FOLLOW_UPS: FollowUpEntry[] = [
  {
    issueId: "worst-1",
    repoId: "r1",
    number: 999_999,
    title: "Flaky integration suite fails intermittently on CI when the upstream provider answers",
    url: "https://github.com/northwind-industries-holdings/customer-identity-platform/issues/999999",
    provider: "github",
    fullName: "northwind-industries-holdings/customer-identity-platform",
    state: "waiting",
    reason: null,
    checkedAt: null,
    due: false,
  },
  {
    issueId: "worst-2",
    repoId: "r1",
    number: 1,
    title:
      "Webhook rejects payloads that contain a URL such as https://api.github.com/repos/x/hooks/1",
    url: "https://github.com/a/b/issues/1",
    provider: "github",
    fullName: "a/b",
    state: "waiting",
    reason: "reply",
    checkedAt: hoursAgo(72),
    due: true,
  },
  {
    issueId: "worst-3",
    repoId: "r2",
    number: 4200,
    title: "Every label at once",
    url: "https://gitlab.com/group/subgroup/project-with-a-long-name/-/issues/4200",
    provider: "gitlab",
    fullName: "group/subgroup/project-with-a-long-name",
    state: "waiting",
    reason: "reopened",
    checkedAt: hoursAgo(0.02),
    due: true,
  },
  {
    issueId: "worst-4",
    repoId: "r2",
    number: 7,
    title: "Không hiển thị được tiếng Việt có dấu",
    url: "https://github.com/acme/console/issues/7",
    provider: "github",
    fullName: "acme/console",
    state: "reviewed",
    reason: null,
    checkedAt: hoursAgo(5),
    due: false,
  },
  {
    issueId: "worst-5",
    repoId: "r3",
    number: 8,
    title: "Ship the new triage queue",
    url: "https://github.com/acme/console/issues/8",
    provider: "github",
    fullName: "acme/console",
    state: "stopped",
    reason: null,
    checkedAt: hoursAgo(9),
    due: false,
  },
];

/**
 * The worst case for the saved-reply picker.
 *
 * A name at the API's 80 character cap, a body at GitHub's comment cap, a body
 * at GitLab's, and a template that is one unbreakable token.
 */
export const WORST_CASE_SAVED_REPLIES: SavedReply[] = [
  {
    id: "saved-1",
    name: "Cannot reproduce without the version, the exact command, and the full log output",
    body: commentAtLimit(65_536),
    createdAt: hoursAgo(240),
    updatedAt: hoursAgo(2),
  },
  {
    id: "saved-2",
    name: "Thanks for the report",
    body: commentAtLimit(1_000_000),
    createdAt: hoursAgo(240),
    updatedAt: hoursAgo(4),
  },
  {
    id: "saved-3",
    name: "Closing as stale",
    body:
      "Closing this as stale. Reopen it with a reproduction if it still happens, and the queue will " +
      "pick it up again, including through a follow-up if you were already waiting on it.",
    createdAt: hoursAgo(240),
    updatedAt: hoursAgo(6),
  },
  {
    id: "saved-4",
    name: "One long token",
    body: "Supercalifragilisticexpialidociouspneumonoultramicroscopicsilicovolcanoconiosis".repeat(
      20
    ),
    createdAt: hoursAgo(240),
    updatedAt: hoursAgo(8),
  },
];

/**
 * The discussion for a mode.
 *
 * @param mode - The active data mode.
 * @returns The comments the mode stands for.
 */
export function commentsForMode(mode: DataMode): ReplyComment[] {
  if (mode === "empty") return [];
  if (mode === "one") return WORST_CASE_COMMENTS.slice(0, 1);
  if (mode === "many") return manyComments();
  return WORST_CASE_COMMENTS;
}

/**
 * The follow-up queue for a mode.
 *
 * `checkedAt` is derived from the entries the same way `GET /api/follow-ups`
 * derives it, so the freshness line a fixture produces is the one the server
 * would produce for the same rows.
 *
 * @param mode - The active data mode.
 * @returns The queue the mode stands for.
 */
export function followUpsForMode(mode: DataMode): FollowUpList {
  // Derived from the issues this mode actually renders. The static rows name
  // `worst-*` ids, which `many` mode does not contain, so a follow-up there would
  // point at an issue the list cannot open.
  const entries =
    mode === "empty"
      ? []
      : mode === "many"
        ? manyIssues(3).map((issue, index) => ({
            ...WORST_CASE_FOLLOW_UPS[index % WORST_CASE_FOLLOW_UPS.length],
            issueId: issue.id,
            repoId: issue.repoId,
            number: issue.number,
            title: issue.title,
            url: issue.url,
          }))
        : mode === "one"
          ? WORST_CASE_FOLLOW_UPS.slice(0, 1)
          : WORST_CASE_FOLLOW_UPS;

  const checkedAt = entries.reduce<string | null>((latest, entry) => {
    if (!entry.checkedAt) return latest;
    return !latest || entry.checkedAt > latest ? entry.checkedAt : latest;
  }, null);

  return { entries, checkedAt };
}

/**
 * The saved replies for a mode.
 *
 * @param mode - The active data mode.
 * @returns The templates the mode stands for.
 */
export function savedRepliesForMode(mode: DataMode): SavedReply[] {
  if (mode === "empty") return [];
  if (mode === "one") return WORST_CASE_SAVED_REPLIES.slice(0, 1);
  return WORST_CASE_SAVED_REPLIES;
}
