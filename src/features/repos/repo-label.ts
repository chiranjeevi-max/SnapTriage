/**
 * @module repos/repo-label
 *
 * Pure helpers for naming a repository in the queue and the reading pane.
 *
 * A provider's `fullName` is machine data and can be longer than either column:
 * a GitLab subgroup path reached 78 characters in the worst-case fixtures. The
 * row needs both ends, the group and the repository suffix that tells similar
 * repos apart, so a plain trailing ellipsis is not enough. These helpers
 * shorten the middle while keeping the ends.
 */

/**
 * Truncates the middle of a string, keeping its head and tail.
 *
 * @param value - The string to shorten.
 * @param max - Maximum length of the result.
 * @returns The original string when it fits, otherwise an end-preserving ellipsis.
 */
function truncateMiddle(value: string, max: number): string {
  if (value.length <= max) return value;
  if (max <= 1) return "…";

  const head = Math.ceil((max - 1) / 2);
  const tail = max - 1 - head;
  if (tail === 0) return `${value.slice(0, max - 1)}…`;
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}

/**
 * Shortens a repository full name while keeping the owner and repository ends.
 *
 * @param fullName - `owner/repo`, or a GitLab `group/subgroup/repo` path.
 * @param max - Maximum length of the result, including the separator.
 * @returns The original name when it fits, otherwise an end-preserving ellipsis.
 */
export function shortenRepoName(fullName: string, max = 40): string {
  if (fullName.length <= max) return fullName;
  if (max <= 1) return "…";
  if (max <= 3) return `${fullName.slice(0, max - 1)}…`;

  const separator = fullName.lastIndexOf("/");
  if (separator <= 0) return `${fullName.slice(0, max - 1)}…`;

  const owner = fullName.slice(0, separator);
  const name = fullName.slice(separator + 1);
  // The owner gets a first bid, then the repository takes every character the
  // actual shortened owner left. A fixed split wasted the difference whenever
  // the owner was short.
  let ownerBudget = Math.min(owner.length, Math.max(1, Math.floor((max - 1) * 0.45)));
  let shortOwner = truncateMiddle(owner, ownerBudget);
  let nameBudget = max - 1 - shortOwner.length;

  if (nameBudget < 2 && owner.length > 1) {
    ownerBudget = Math.max(1, ownerBudget - (2 - nameBudget));
    shortOwner = truncateMiddle(owner, ownerBudget);
    nameBudget = max - 1 - shortOwner.length;
  }

  const shortName = truncateMiddle(name, Math.max(1, nameBudget));
  return `${shortOwner}/${shortName}`;
}

/**
 * Builds the repo id to full name lookup the queue and pane read from.
 *
 * @param repos - The connected repositories, as the repos API returns them.
 * @returns A map keyed by repository id.
 */
export function repoNameMap(repos: ReadonlyArray<{ id: string; fullName: string }>) {
  return new Map(repos.map((repo) => [repo.id, repo.fullName]));
}
