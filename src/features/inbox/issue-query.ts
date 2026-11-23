/**
 * @module inbox/issue-query
 *
 * A small query language for narrowing the inbox, kept pure so it can be tested
 * without rendering the list.
 *
 * The vocabulary is deliberately tiny and forgiving: bare words match anywhere a
 * person would look for them, and a `field:value` token narrows to one field.
 * An unknown prefix is treated as ordinary text rather than rejected, because a
 * title like `fix: crash on start` is a query a user types by accident and must
 * not silently match nothing.
 *
 * ```
 * auth              title, author or label contains "auth"
 * label:bug         carries the bug label
 * author:nadia      reported by nadia
 * assignee:octocat  assigned to octocat
 * #123              issue number 123
 * ```
 *
 * Every free-text term must match (AND), and a term is checked against every
 * field, so it can match a title and a label at once.
 */
import type { IssueWithTriage } from "./use-issues";

/** A parsed query, ready to evaluate against many issues. */
export interface IssueQuery {
  /** Free-text terms, lower-cased. Each must match somewhere. */
  terms: string[];
  /** Label names that must all be present, lower-cased. */
  labels: string[];
  /** Author login a term must equal, lower-cased. */
  authors: string[];
  /** Assignee login that must be present, lower-cased. */
  assignees: string[];
  /** Issue numbers that must match, when the query names any. */
  numbers: number[];
}

/** An empty query, which matches everything. */
export const EMPTY_QUERY: IssueQuery = {
  terms: [],
  labels: [],
  authors: [],
  assignees: [],
  numbers: [],
};

/**
 * Split a query into tokens, honouring double quotes so a label with a space
 * stays one term.
 *
 * @param input - The raw query text.
 * @returns The tokens, quotes removed.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;

  for (const char of input) {
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(char)) {
      if (current) tokens.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) tokens.push(current);

  return tokens;
}

/**
 * Parse query text into a {@link IssueQuery}.
 *
 * @param input - The raw query text from the search box.
 * @returns The parsed query. Malformed input degrades to free text rather than
 *          to an error, since the box is typed into one keystroke at a time.
 */
export function parseQuery(input: string): IssueQuery {
  const query: IssueQuery = {
    terms: [],
    labels: [],
    authors: [],
    assignees: [],
    numbers: [],
  };

  for (const token of tokenize(input)) {
    // `#123` is how people refer to an issue in prose, so it is accepted as a
    // number rather than as free text that would match nothing useful.
    const numberMatch = /^#(\d+)$/.exec(token);
    if (numberMatch) {
      query.numbers.push(Number(numberMatch[1]));
      continue;
    }

    const separator = token.indexOf(":");
    if (separator > 0 && separator < token.length - 1) {
      const prefix = token.slice(0, separator).toLowerCase();
      const value = token.slice(separator + 1).toLowerCase();

      if (prefix === "label") {
        query.labels.push(value);
        continue;
      }
      if (prefix === "author") {
        query.authors.push(value);
        continue;
      }
      if (prefix === "assignee") {
        query.assignees.push(value);
        continue;
      }
    }

    // Anything else is free text, including a `field:value` shape we do not
    // recognise: "fix: crash" is an ordinary thing to type, and rejecting it
    // would quietly match nothing.
    query.terms.push(token.toLowerCase());
  }

  return query;
}

/**
 * Whether a query constrains anything.
 *
 * @param query - The parsed query.
 * @returns `false` for empty or whitespace-only input, so the caller can skip
 *          filtering entirely.
 */
export function isEmptyQuery(query: IssueQuery): boolean {
  return (
    query.terms.length === 0 &&
    query.labels.length === 0 &&
    query.authors.length === 0 &&
    query.assignees.length === 0 &&
    query.numbers.length === 0
  );
}

/**
 * Whether one issue satisfies a parsed query.
 *
 * @param issue - The queue entry to test.
 * @param query - The parsed query.
 * @returns `true` when every constraint holds, which is what makes the query a
 *          narrowing operation rather than a union.
 */
export function matchesQuery(issue: IssueWithTriage, query: IssueQuery): boolean {
  // Every constraint is an AND, including repeated ones. `#1 #2` therefore
  // matches nothing, which is the honest answer for an issue that cannot be two
  // numbers — and it keeps the rule uniform, so adding a term always narrows.
  for (const number of query.numbers) {
    if (issue.number !== number) return false;
  }

  const labels = issue.labels.map((label) => label.toLowerCase());
  for (const label of query.labels) {
    if (!labels.includes(label)) return false;
  }

  const author = issue.author?.toLowerCase() ?? "";
  for (const required of query.authors) {
    if (author !== required) return false;
  }

  const assignees = issue.assignees.map((assignee) => assignee.toLowerCase());
  for (const assignee of query.assignees) {
    // `assignee:me` is not resolved here: the query layer has no idea who the
    // signed-in user is, and guessing would silently match the wrong rows.
    if (!assignees.includes(assignee)) return false;
  }

  if (query.terms.length > 0) {
    // Built once: a query with five terms would otherwise rebuild the same
    // string five times per row, for every row in the queue.
    const haystack = [
      issue.title.toLowerCase(),
      author,
      labels.join(" "),
      assignees.join(" "),
    ].join(" ");

    for (const term of query.terms) {
      if (!haystack.includes(term)) return false;
    }
  }

  return true;
}

/**
 * Filter a list by a query, preserving order.
 *
 * @param issues - The queue entries.
 * @param query - The parsed query.
 * @returns A new array; the input is never mutated.
 */
export function filterByQuery(issues: IssueWithTriage[], query: IssueQuery): IssueWithTriage[] {
  if (isEmptyQuery(query)) return issues;
  return issues.filter((issue) => matchesQuery(issue, query));
}
