/**
 * @module tests/unit/support/fake-db
 *
 * An in-memory stand-in for `typedDb`, for route tests that need the real
 * service code without a real database.
 *
 * It is not a SQL engine. It models exactly the queries the triage, preset,
 * reply, and follow-up paths issue — single-table selects, selects of
 * `{ issue, repo }` and `{ followUp, issue, repo }` through the ownership
 * joins, `count()`, `insert ... onConflictDoNothing` / `onConflictDoUpdate`,
 * `update`, `delete ... returning`, `ORDER BY` and `LIMIT` — over eight row
 * arrays.
 *
 * Three properties make it worth the code rather than mocking each repository
 * module:
 *
 * - **It evaluates the real WHERE clause.** Drizzle hands each `eq()`/`and()`/
 *   `inArray()` tree over as opaque SQL chunks; these functions flatten it and
 *   compare it against the rows, so ownership is enforced the way the scoped
 *   SQL enforces it. A test that passes another user's id gets the empty result
 *   the database would produce, not a stub's opinion about it.
 * - **It enforces the unique indexes.** A second row with the same natural key
 *   is a conflict, so `onConflictDoNothing` keeps the stored row and
 *   `onConflictDoUpdate` applies the caller's `set` to it. That is what makes
 *   "a stale writer cannot overwrite a newer draft" and "a recorded send
 *   attempt survives a retry" observable at all.
 * - **It records an ordered log.** Every read and write appends one entry, so a
 *   test can assert that the provider was called *before* local state was
 *   written, rather than only that both eventually happened.
 */
import {
  followUps,
  issues,
  providerIdentities,
  replyDrafts,
  repos,
  savedReplies,
  triagePresets,
  triageState,
} from "@/lib/db/schema";
import { DB_NOW_PLUS } from "@/lib/db/db-clock";

export type IssueRow = typeof issues.$inferSelect;
export type RepoRow = typeof repos.$inferSelect;
export type TriageStateRow = typeof triageState.$inferSelect;
export type PresetRow = typeof triagePresets.$inferSelect;
export type ReplyDraftRow = typeof replyDrafts.$inferSelect;
export type SavedReplyRow = typeof savedReplies.$inferSelect;
export type FollowUpRow = typeof followUps.$inferSelect;
export type ProviderIdentityRow = typeof providerIdentities.$inferSelect;

type TableKey =
  | "issue"
  | "repo"
  | "triage_state"
  | "triage_preset"
  | "reply_draft"
  | "saved_reply"
  | "follow_up"
  | "provider_identity";

const TABLE_ENTRIES: ReadonlyArray<[TableKey, object]> = [
  ["issue", issues],
  ["repo", repos],
  ["triage_state", triageState],
  ["triage_preset", triagePresets],
  ["reply_draft", replyDrafts],
  ["saved_reply", savedReplies],
  ["follow_up", followUps],
  ["provider_identity", providerIdentities],
];

/**
 * The columns each table's unique index covers, in schema order.
 *
 * Two rows that agree on these are one row as far as the database is
 * concerned, so a second insert is a conflict rather than another row. A table
 * with no entry here accepts duplicates: `saved_reply` is deliberately one,
 * because a user may keep two templates that say the same thing under
 * different names.
 */
const NATURAL_KEYS: Partial<Record<TableKey, readonly string[]>> = {
  triage_state: ["issueId", "userId"],
  reply_draft: ["issueId", "userId"],
  follow_up: ["issueId", "userId"],
  provider_identity: ["userId", "provider"],
};

type Row = Record<string, unknown>;

/** Columns and parameters as they appear inside a flattened condition. */
type Token = { column: { name: string; table: object } } | { param: unknown } | string;

function isColumn(value: object): value is { name: string; table: object } {
  return typeof (value as { name?: unknown }).name === "string" && "table" in value;
}

function isTable(value: unknown): boolean {
  return TABLE_ENTRIES.some(([, object]) => object === value);
}

/** Flatten drizzle's nested SQL chunk tree into a left-to-right token list. */
function flatten(node: unknown, out: Token[] = []): Token[] {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const item of node) flatten(item, out);
    return out;
  }
  if (typeof node !== "object") return out;

  const obj = node as Record<string, unknown>;

  if (Array.isArray(obj.queryChunks)) {
    flatten(obj.queryChunks, out);
    return out;
  }
  if (Array.isArray(obj.value) && (obj.value as unknown[]).every((v) => typeof v === "string")) {
    const text = (obj.value as string[]).join("");
    if (text) out.push(text);
    return out;
  }
  if (isColumn(obj)) {
    out.push({ column: obj });
    return out;
  }
  if ("value" in obj) {
    out.push({ param: obj.value });
  }
  return out;
}

function stripParens(tokens: Token[]): Token[] {
  let result = tokens;
  while (
    result.length > 2 &&
    result[0] === "(" &&
    result[result.length - 1] === ")" &&
    depthBalanced(result.slice(1, -1))
  ) {
    result = result.slice(1, -1);
  }
  return result;
}

function depthBalanced(tokens: Token[]): boolean {
  let depth = 0;
  for (const token of tokens) {
    if (token === "(") depth++;
    if (token === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function topLevelIndex(tokens: Token[], needle: string): number {
  let depth = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token === "(") depth++;
    if (token === ")") depth--;
    if (depth === 0 && token === needle) return index;
  }
  return -1;
}

function resolve(token: Token, scope: ReadonlyMap<object, Row>): unknown {
  if (typeof token === "string") return token;
  if ("param" in token) return token.param;
  const row = scope.get(token.column.table);
  return row ? row[token.column.name] : undefined;
}

function scalar(value: unknown): unknown {
  if (value instanceof Date) return value.getTime();
  return value;
}

/** The binary comparison operators drizzle emits as a bare separator token. */
const COMPARISONS: Record<string, (left: unknown, right: unknown) => boolean> = {
  " = ": (left, right) => left === right,
  " <> ": (left, right) => left !== right,
  " > ": (left, right) => compareValues(left, right) > 0,
  " < ": (left, right) => compareValues(left, right) < 0,
  " >= ": (left, right) => compareValues(left, right) >= 0,
  " <= ": (left, right) => compareValues(left, right) <= 0,
};

/**
 * Evaluate one flattened condition against one row scope.
 *
 * Supports the shapes this codebase actually writes: `eq`, `ne`, `lt`, `isNull`,
 * `and`, `or`, and `inArray`, with their nesting. A comparison against a null
 * operand is false, as it is in SQL — which is why the source takes its send
 * claim with `isNull` rather than `eq(column, null)`, and why the fake has to
 * model the difference. Anything else throws, so a test cannot silently pass
 * because an unhandled condition was treated as true.
 */
function matches(condition: unknown, scope: ReadonlyMap<object, Row>): boolean {
  const tokens = stripParens(flatten(condition));

  const andAt = topLevelIndex(tokens, " and ");
  if (andAt !== -1) {
    const left = tokens.slice(0, andAt);
    const right = tokens.slice(andAt + 1);
    return matches(tokensToCondition(left), scope) && matches(tokensToCondition(right), scope);
  }

  const orAt = topLevelIndex(tokens, " or ");
  if (orAt !== -1) {
    const left = tokens.slice(0, orAt);
    const right = tokens.slice(orAt + 1);
    return matches(tokensToCondition(left), scope) || matches(tokensToCondition(right), scope);
  }

  if (tokens.length === 2 && (tokens[1] === " is null" || tokens[1] === " is not null")) {
    const value = resolve(tokens[0], scope);
    return tokens[1] === " is null" ? value === null : value !== null;
  }

  if (tokens.length === 3 && typeof tokens[1] === "string" && tokens[1] in COMPARISONS) {
    const left = scalar(resolve(tokens[0], scope));
    const right = scalar(resolve(tokens[2], scope));
    if (left === null || left === undefined || right === null || right === undefined) return false;
    return COMPARISONS[tokens[1]](left, right);
  }

  // `inArray` flattens to `column in <param> <param> ...`, one token per element.
  const inAt = tokens.findIndex((token) => token === " in ");
  if (inAt === 1 && tokens.length >= 3) {
    const values = tokens.slice(2).flatMap((token) => {
      const value = resolve(token, scope);
      return Array.isArray(value) ? value.map(scalar) : [scalar(value)];
    });
    return values.includes(scalar(resolve(tokens[0], scope)));
  }

  throw new Error(`fake-db: unsupported condition shape: ${describeTokens(tokens)}`);
}

/** Render a token list for an error message without walking table cycles. */
function describeTokens(tokens: Token[]): string {
  return tokens
    .map((token) => {
      if (typeof token === "string") return JSON.stringify(token);
      if ("param" in token) return JSON.stringify(token.param);
      return `<${token.column.name}>`;
    })
    .join(" ");
}

/**
 * Re-wrap a token slice so `matches` can re-inspect it.
 *
 * Slicing an `and(...)` tree loses the chunk boundaries, so the split halves are
 * carried as a pseudo condition object that `flatten` already understands.
 */
function tokensToCondition(tokens: Token[]): object {
  const queryChunks = tokens.map((token) => {
    if (typeof token === "string") return { value: [token] };
    if ("param" in token) return { value: token.param };
    return token.column;
  });
  return { queryChunks };
}

/** Read one `ORDER BY` term: a bare column ascends, `desc(column)` descends. */
function parseOrderTerm(term: unknown): { field: string; descending: boolean } | null {
  if (typeof term !== "object" || term === null) return null;
  if (isColumn(term)) return { field: term.name, descending: false };

  const chunks = (term as { queryChunks?: unknown[] }).queryChunks;
  if (!Array.isArray(chunks)) return null;

  const column = chunks.find(
    (chunk) => typeof chunk === "object" && chunk !== null && isColumn(chunk)
  );
  if (!column) return null;

  const descending = chunks.some((chunk) => {
    const value = (chunk as { value?: unknown }).value;
    return Array.isArray(value) && value.join("").toLowerCase().includes("desc");
  });

  return { field: (column as { name: string }).name, descending };
}

function compareValues(left: unknown, right: unknown): number {
  if (left instanceof Date && right instanceof Date) return left.getTime() - right.getTime();
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left ?? "").localeCompare(String(right ?? ""));
}

/** Read a projected field off a row, whether the row is flat or nested by alias. */
function fieldOf(row: Row, field: string): unknown {
  if (field in row) return row[field];
  for (const value of Object.values(row)) {
    if (value && typeof value === "object" && field in (value as Row)) {
      return (value as Row)[field];
    }
  }
  return undefined;
}

function sortRows<RowType extends Row>(rows: RowType[], terms: unknown[]): RowType[] {
  const parsed = terms
    .map(parseOrderTerm)
    .filter((term): term is { field: string; descending: boolean } => term !== null);
  if (parsed.length === 0) return rows;

  return [...rows].sort((left, right) => {
    for (const term of parsed) {
      const comparison = compareValues(fieldOf(left, term.field), fieldOf(right, term.field));
      if (comparison !== 0) return term.descending ? -comparison : comparison;
    }
    return 0;
  });
}

/**
 * Resolve a write value the way the database would, at apply time.
 *
 * A `dbNowPlus` fragment carries the number of milliseconds to add; evaluating
 * it here, when the fake applies the row, is what lets a delayed-write test see
 * a deadline stamped after the delay. Any other SQL fragment is unsupported and
 * throws rather than landing in a row as an object.
 */
function applyValue(value: unknown): unknown {
  if (typeof value === "object" && value !== null) {
    const marker = (value as Record<symbol, unknown>)[DB_NOW_PLUS];
    if (typeof marker === "number") return new Date(Date.now() + marker);
    if ("queryChunks" in (value as object)) {
      throw new Error("fake-db: unsupported SQL expression in a write value");
    }
  }
  return value;
}

/** Resolve every value in a `set` object at apply time. */
function resolveSet(values: Row): Row {
  const resolved: Row = {};
  for (const [key, value] of Object.entries(values)) {
    resolved[key] = applyValue(value);
  }
  return resolved;
}

/** A resolved query result that also answers the builder methods callers chain. */
interface QueryResult<RowType> extends Promise<RowType[]> {
  orderBy(...terms: unknown[]): QueryResult<RowType>;
  limit(count: number): QueryResult<RowType>;
  returning(): Promise<RowType[]>;
  onConflictDoNothing(): Promise<RowType[]>;
  onConflictDoUpdate(config: unknown): Promise<RowType[]>;
}

function queryResult<RowType extends Row>(rows: RowType[]): QueryResult<RowType> {
  const promise = Promise.resolve(rows) as unknown as QueryResult<RowType>;
  return Object.assign(promise, {
    orderBy: (...terms: unknown[]) => queryResult(sortRows(rows, terms)),
    limit: (count: number) => queryResult(rows.slice(0, Math.max(count, 0))),
    returning: () => Promise.resolve(rows),
    onConflictDoNothing: () => promise,
    onConflictDoUpdate: () => promise,
  });
}

/** How an insert resolves a row whose natural key is already stored. */
type ConflictMode =
  { kind: "error" } | { kind: "skip" } | { kind: "update"; target: unknown; set: Row };

/** The mutable contents of a fake database. */
export interface FakeDbState {
  rows: {
    issue: IssueRow[];
    repo: RepoRow[];
    triage_state: TriageStateRow[];
    triage_preset: PresetRow[];
    reply_draft: ReplyDraftRow[];
    saved_reply: SavedReplyRow[];
    follow_up: FollowUpRow[];
    provider_identity: ProviderIdentityRow[];
  };
  /** Ordered operation log, e.g. `db:update:triage_state`. */
  log: string[];
  /**
   * When set, every update waits this long before applying.
   *
   * A stalled database stalls all writes, not just the first one, so a test that
   * needs to prove a deadline is stamped inside its write must delay the whole
   * sequence. Reset by {@link FakeDb.reset}.
   */
  updateDelayMs?: number;
  /**
   * When set, every update applies immediately but resolves this long after.
   *
   * This is the other half of a slow write: the row is durable, but the app
   * waits for the response before it starts the provider call. Reset by
   * {@link FakeDb.reset}.
   */
  updateResponseDelayMs?: number;
}

/** A fake database and its `typedDb` replacement. */
export interface FakeDb {
  state: FakeDbState;
  typedDb: unknown;
  reset(): void;
}

function keyOf(table: unknown): TableKey {
  for (const [key, object] of TABLE_ENTRIES) {
    if (object === table) return key;
  }
  throw new Error("fake-db: query touched a table it does not model");
}

function defaultsFor(key: TableKey, values: Row): Row {
  const now = new Date();

  if (key === "triage_state") {
    return {
      id: `triage-${crypto.randomUUID()}`,
      dismissed: false,
      batchPending: false,
      revision: 0,
      pendingChanges: {},
      updatedAt: now,
      ...values,
    };
  }
  if (key === "triage_preset") {
    return { id: `preset-${crypto.randomUUID()}`, createdAt: now, updatedAt: now, ...values };
  }
  if (key === "reply_draft") {
    return {
      id: `draft-${crypto.randomUUID()}`,
      body: "",
      version: 1,
      sendAttemptedAt: null,
      createdAt: now,
      updatedAt: now,
      ...values,
    };
  }
  if (key === "saved_reply") {
    return { id: `saved-${crypto.randomUUID()}`, createdAt: now, updatedAt: now, ...values };
  }
  if (key === "follow_up") {
    return {
      id: `follow-up-${crypto.randomUUID()}`,
      state: "waiting",
      lastSeenCommentId: null,
      lastSeenCommentAt: null,
      stateAtBaseline: "open",
      reviewedCommentId: null,
      reason: null,
      checkedAt: null,
      createdAt: now,
      updatedAt: now,
      ...values,
    };
  }
  if (key === "provider_identity") {
    return { id: `identity-${crypto.randomUUID()}`, avatar: null, fetchedAt: now, ...values };
  }
  return { id: `${key}-${crypto.randomUUID()}`, ...values };
}

/** Resolve a projection entry for one row scope. */
function project(projection: Record<string, unknown>, scope: ReadonlyMap<object, Row>): Row {
  const projected: Row = {};
  for (const [alias, source] of Object.entries(projection)) {
    if (isTable(source)) {
      projected[alias] = scope.get(source as object);
      continue;
    }
    if (typeof source === "object" && source !== null && isColumn(source)) {
      const row = scope.get(source.table);
      projected[alias] = row ? row[source.name] : undefined;
      continue;
    }
    // `sql\`${column}\`` wraps a column so the driver hands back raw text. The
    // fake has no codec to bypass, so it resolves the wrapped column directly.
    const wrapped = wrappedColumn(source);
    if (wrapped) {
      const row = scope.get(wrapped.table);
      projected[alias] = row ? row[wrapped.name] : undefined;
      continue;
    }
    projected[alias] = source;
  }
  return projected;
}

/**
 * Find the single column a `sql` chunk wraps, if that is all it does.
 *
 * `sql\`${column}\`` produces a chunk whose query strings are empty and whose
 * only binding is the column. Anything more complex is not a plain column read
 * and is left alone.
 */
function wrappedColumn(node: unknown): { table: object; name: string } | null {
  const chunks = (node as { queryChunks?: unknown[] } | null)?.queryChunks;
  if (!Array.isArray(chunks)) return null;

  const found: Token[] = [];
  flatten(chunks, found);
  const columns = found.filter(
    (token): token is { column: { table: object; name: string } } =>
      typeof token === "object" && "column" in token
  );
  return columns.length === 1 ? columns[0].column : null;
}

/**
 * Create a fake database.
 *
 * @returns The fake, its row store, and a `reset` that clears both rows and log.
 */
export function createFakeDb(): FakeDb {
  const state: FakeDbState = {
    rows: {
      issue: [],
      repo: [],
      triage_state: [],
      triage_preset: [],
      reply_draft: [],
      saved_reply: [],
      follow_up: [],
      provider_identity: [],
    },
    log: [],
  };

  function tableRows(key: TableKey): Row[] {
    return state.rows[key] as unknown as Row[];
  }

  const typedDb = {
    select(projection?: Record<string, unknown>) {
      const counting = projection !== undefined && "total" in projection;

      return {
        from(table: unknown) {
          const root = { table: table as object, key: keyOf(table) };
          const joins: Array<{ table: object; key: TableKey; on: unknown }> = [];

          const run = (condition?: unknown): Array<Map<object, Row>> => {
            const label = [root, ...joins].map((source) => source.key).join("+");
            state.log.push(`db:select:${label}`);

            let scopes: Array<Map<object, Row>> = tableRows(root.key).map(
              (row) => new Map<object, Row>([[root.table, row]])
            );

            for (const join of joins) {
              const widened: Array<Map<object, Row>> = [];
              for (const scope of scopes) {
                for (const row of tableRows(join.key)) {
                  const combined = new Map(scope);
                  combined.set(join.table, row);
                  if (join.on === undefined || matches(join.on, combined)) widened.push(combined);
                }
              }
              scopes = widened;
            }

            return scopes.filter((scope) => condition === undefined || matches(condition, scope));
          };

          const materialize = (scopes: Array<Map<object, Row>>): Row[] => {
            if (counting) return [{ total: scopes.length }];
            if (!projection) return scopes.map((scope) => scope.get(root.table) as Row);
            return scopes.map((scope) => project(projection, scope));
          };

          const builder = {
            innerJoin(joinTable: unknown, on: unknown) {
              joins.push({ table: joinTable as object, key: keyOf(joinTable), on });
              return builder;
            },

            where(condition?: unknown) {
              // The filtered rows, then chained through `queryResult` so
              // `.orderBy()` and `.limit()` apply to this result rather than
              // starting from the unfiltered table again.
              return queryResult(materialize(run(condition)));
            },
          };

          return builder;
        },
      };
    },

    insert(table: unknown) {
      const key = keyOf(table);

      return {
        values(input: Row | Row[]) {
          const incoming = Array.isArray(input) ? input : [input];
          let written: Row[] | null = null;

          const write = (conflict: ConflictMode): Row[] => {
            if (written) return written;

            const keyFields = NATURAL_KEYS[key];
            const created: Row[] = [];

            for (const values of incoming) {
              const row = defaultsFor(key, resolveSet(values));
              const existing = keyFields
                ? tableRows(key).find((candidate) =>
                    keyFields.every((field) => candidate[field] === row[field])
                  )
                : undefined;

              if (!existing) {
                tableRows(key).push(row);
                created.push(row);
                continue;
              }

              if (conflict.kind === "error") {
                throw new Error(
                  `fake-db: unique constraint failed on ${key} (${keyFields?.join(", ")})`
                );
              }
              if (conflict.kind === "skip") continue;

              Object.assign(existing, resolveSet(conflict.set));
              created.push(existing);
            }

            state.log.push(`db:insert:${key}`);
            written = created;
            return created;
          };

          const builder = {
            onConflictDoNothing() {
              return queryResult(write({ kind: "skip" }));
            },
            onConflictDoUpdate(config: { target?: unknown; set?: Row }) {
              return queryResult(
                write({ kind: "update", target: config?.target, set: config?.set ?? {} })
              );
            },
            returning() {
              return queryResult(write({ kind: "error" }));
            },
            then<TResult1 = Row[], TResult2 = never>(
              onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
              onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
            ) {
              return queryResult(write({ kind: "error" })).then(onfulfilled, onrejected);
            },
          };

          return builder;
        },
      };
    },

    update(table: unknown) {
      const key = keyOf(table);

      return {
        set(values: Row) {
          return {
            where(condition?: unknown) {
              const apply = () => {
                const resolved = resolveSet(values);
                const updated: Row[] = [];
                for (const row of tableRows(key)) {
                  const scope = new Map<object, Row>([[table as object, row]]);
                  if (condition !== undefined && !matches(condition, scope)) continue;
                  Object.assign(row, resolved);
                  updated.push(row);
                }
                state.log.push(`db:update:${key}`);
                return updated;
              };

              const writeDelay = state.updateDelayMs ?? 0;
              const responseDelay = state.updateResponseDelayMs ?? 0;
              if (writeDelay > 0 || responseDelay > 0) {
                // A write delay applies after the wait, so a `dbNowPlus` value
                // is evaluated at the instant the row changes. A response delay
                // applies immediately and holds the promise, modelling a slow
                // reply after the row is durable.
                const settle = () => {
                  const applied =
                    writeDelay > 0
                      ? new Promise<Row[]>((resolve) =>
                          setTimeout(() => resolve(apply()), writeDelay)
                        )
                      : Promise.resolve(apply());
                  return responseDelay > 0
                    ? applied.then(
                        (rows) =>
                          new Promise<Row[]>((resolve) =>
                            setTimeout(() => resolve(rows), responseDelay)
                          )
                      )
                    : applied;
                };

                return {
                  then: <TResult1 = Row[], TResult2 = never>(
                    onfulfilled?: ((value: Row[]) => TResult1 | PromiseLike<TResult1>) | null,
                    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
                  ) => settle().then(onfulfilled, onrejected),
                  returning: () => settle(),
                };
              }

              return queryResult(apply());
            },
          };
        },
      };
    },

    delete(table: unknown) {
      const key = keyOf(table);

      return {
        where(condition?: unknown) {
          const kept: Row[] = [];
          const removed: Row[] = [];
          for (const row of tableRows(key)) {
            const scope = new Map<object, Row>([[table as object, row]]);
            if (condition === undefined || matches(condition, scope)) removed.push(row);
            else kept.push(row);
          }
          state.rows[key] = kept as never;
          state.log.push(`db:delete:${key}`);
          return queryResult(removed);
        },
      };
    },
  };

  return {
    state,
    typedDb,
    reset() {
      state.rows = {
        issue: [],
        repo: [],
        triage_state: [],
        triage_preset: [],
        reply_draft: [],
        saved_reply: [],
        follow_up: [],
        provider_identity: [],
      };
      state.log = [];
      state.updateDelayMs = undefined;
      state.updateResponseDelayMs = undefined;
    },
  };
}

/**
 * The fake used by the route and repository tests.
 *
 * Exported as a singleton because `vi.mock` factories are hoisted above the
 * test file's imports: the factory has to `await import` this module, and a
 * singleton is what makes the instance the mock captured the same instance the
 * test seeds.
 */
export const fakeDb = createFakeDb();

/**
 * Fixture ids, in UUID form.
 *
 * The request schemas validate identifiers as UUIDs, so a fixture id that is
 * not one would be rejected by the body parser before the handler under test
 * ever ran — the test would pass for the wrong reason.
 */
export const REPO_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_REPO_ID = "11111111-1111-4111-8111-222222222222";
export const ISSUE_ID = "22222222-2222-4222-8222-222222222222";
export const OTHER_ISSUE_ID = "22222222-2222-4222-8222-333333333333";
export const PRESET_ID = "33333333-3333-4333-8333-333333333333";
export const TRIAGE_ID = "44444444-4444-4444-8444-444444444444";
export const DRAFT_ID = "55555555-5555-4555-8555-555555555555";
export const SAVED_REPLY_ID = "66666666-6666-4666-8666-666666666666";
export const FOLLOW_UP_ID = "77777777-7777-4777-8777-777777777777";

/** A repository owned by `user-1`. */
export function repoRow(overrides: Partial<RepoRow> = {}): RepoRow {
  return {
    id: REPO_ID,
    userId: "user-1",
    provider: "github",
    owner: "octo",
    name: "repo",
    fullName: "octo/repo",
    permission: "write",
    syncEnabled: true,
    syncMode: "live",
    lastSyncedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** A cached issue inside the default repo. */
export function issueRow(overrides: Partial<IssueRow> = {}): IssueRow {
  return {
    id: ISSUE_ID,
    repoId: REPO_ID,
    provider: "github",
    number: 7,
    title: "Crash on start",
    body: null,
    author: "nadia",
    authorAvatar: null,
    state: "open",
    labels: [],
    assignees: [],
    url: "https://github.com/octo/repo/issues/7",
    providerIssueId: "gh-7",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    fetchedAt: new Date("2026-01-03T00:00:00.000Z"),
    ...overrides,
  };
}

/** A triage row for the default issue. */
export function triageRow(overrides: Partial<TriageStateRow> = {}): TriageStateRow {
  return {
    id: TRIAGE_ID,
    issueId: ISSUE_ID,
    userId: "user-1",
    priority: null,
    snoozedUntil: null,
    dismissed: false,
    batchPending: false,
    revision: 0,
    pendingChanges: {},
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
    ...overrides,
  };
}

/** A stored preset for the default repo. */
export function presetRow(overrides: Partial<PresetRow> = {}): PresetRow {
  return {
    id: PRESET_ID,
    userId: "user-1",
    repoId: REPO_ID,
    name: "Confirmed bug",
    actions: { priority: 1, labels: { add: ["bug"] } },
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
    updatedAt: new Date("2026-01-04T00:00:00.000Z"),
    ...overrides,
  };
}

/** A saved draft for the default issue and `user-1`. */
export function replyDraftRow(overrides: Partial<ReplyDraftRow> = {}): ReplyDraftRow {
  return {
    id: DRAFT_ID,
    issueId: ISSUE_ID,
    userId: "user-1",
    body: "Thanks for the report — can you share the stack trace?",
    version: 1,
    sendAttemptedAt: null,
    sendClaimId: null,
    sendInFlightUntil: null,
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
    updatedAt: new Date("2026-01-05T00:00:00.000Z"),
    ...overrides,
  };
}

/** A reply template owned by `user-1`. */
export function savedReplyRow(overrides: Partial<SavedReplyRow> = {}): SavedReplyRow {
  return {
    id: SAVED_REPLY_ID,
    userId: "user-1",
    name: "Need more info",
    body: "Could you share the version and a minimal reproduction?",
    createdAt: new Date("2026-01-06T00:00:00.000Z"),
    updatedAt: new Date("2026-01-06T00:00:00.000Z"),
    ...overrides,
  };
}

/** A waiting follow-up on the default issue for `user-1`. */
export function followUpRow(overrides: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id: FOLLOW_UP_ID,
    issueId: ISSUE_ID,
    userId: "user-1",
    state: "waiting",
    lastSeenCommentId: "90",
    lastSeenCommentAt: new Date("2026-01-07T00:00:00.000Z"),
    stateAtBaseline: "open",
    lastObservedState: null,
    reviewedCommentId: null,
    reason: null,
    checkedAt: null,
    attemptedAt: null,
    createdAt: new Date("2026-01-07T00:00:00.000Z"),
    updatedAt: new Date("2026-01-07T00:00:00.000Z"),
    ...overrides,
  };
}

/** A cached provider login for `user-1` on GitHub. */
export function providerIdentityRow(
  overrides: Partial<ProviderIdentityRow> = {}
): ProviderIdentityRow {
  return {
    id: "88888888-8888-4888-8888-888888888888",
    userId: "user-1",
    provider: "github",
    login: "me",
    avatar: null,
    fetchedAt: new Date("2026-01-08T00:00:00.000Z"),
    ...overrides,
  };
}
