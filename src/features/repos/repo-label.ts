/**
 * @module repos/repo-label
 *
 * Pure helpers for naming a repository in the queue and the reading pane.
 *
 * A provider's `fullName` is machine data and can be longer than either column:
 * a GitLab subgroup path reached 78 characters in the worst-case fixtures. The
 * row needs both ends — the group and the repository — to identify the source,
 * so a plain trailing ellipsis is not enough. These helpers shorten the middle
 * while keeping the string recognizable.
 */

/**
 * Shortens a repository full name while keeping the owner and repository ends.
 *
 * @param fullName - `owner/repo`, or a GitLab `group/subgroup/repo` path.
 * @param max - Maximum length of the result, including the separator.
 * @returns The original name when it fits, otherwise an end-preserving ellipsis.
 */
export function shortenRepoName(fullName: string, max = 40): string {
  if (fullName.length <= max) return fullName;

  const separator = fullName.lastIndexOf("/");
  if (separator <= 0) return `${fullName.slice(0, max - 1)}…`;

  const owner = fullName.slice(0, separator);
  const name = fullName.slice(separator + 1);
  // The repository name is the more specific half, so it gets the larger share.
  const ownerBudget = Math.max(6, Math.floor((max - 1) * 0.45));
  const nameBudget = Math.max(6, max - 1 - ownerBudget);
  const shortOwner = owner.length > ownerBudget ? `${owner.slice(0, ownerBudget - 1)}…` : owner;
  const shortName = name.length > nameBudget ? `${name.slice(0, nameBudget - 1)}…` : name;

  return `${shortOwner}/${shortName}`;
}

/**
 * Builds the repo id → full name lookup the queue and pane read from.
 *
 * @param repos - The connected repositories, as the repos API returns them.
 * @returns A map keyed by repository id.
 */
export function repoNameMap(repos: ReadonlyArray<{ id: string; fullName: string }>) {
  return new Map(repos.map((repo) => [repo.id, repo.fullName]));
}
