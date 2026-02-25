/**
 * @module auth/validate-token
 *
 * Validates Personal Access Tokens against GitHub or GitLab APIs.
 *
 * Used during the PAT sign-in flow: the token is sent to the provider's
 * "get current user" endpoint to verify it's valid and extract user profile data.
 */

/** Supported provider identifiers for PAT validation. */
export type TokenProvider = "github" | "gitlab";

/** Profile data extracted from a successful token validation. */
interface ValidatedUser {
  id: string;
  name: string;
  email: string | null;
  image: string | null;
}

/**
 * Validates a GitHub PAT by calling the `/user` endpoint.
 * @param token - GitHub personal access token.
 * @returns The authenticated user's profile data.
 * @throws If the token is invalid or the API call fails.
 */
export async function validateGitHubToken(token: string): Promise<ValidatedUser> {
  const res = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });

  if (!res.ok) {
    throw new Error("Invalid GitHub token");
  }

  const data = await res.json();
  return {
    id: String(data.id),
    name: data.name || data.login,
    email: data.email,
    image: data.avatar_url,
  };
}

/**
 * Validates a GitLab PAT by calling the `/api/v4/user` endpoint.
 * Supports self-hosted GitLab via `AUTH_GITLAB_URL` env var.
 * @param token - GitLab personal access token.
 * @returns The authenticated user's profile data.
 * @throws If the token is invalid or the API call fails.
 */
export async function validateGitLabToken(token: string): Promise<ValidatedUser> {
  const baseUrl = process.env.AUTH_GITLAB_URL || "https://gitlab.com";
  const res = await fetch(`${baseUrl}/api/v4/user`, {
    headers: { "PRIVATE-TOKEN": token },
  });

  if (!res.ok) {
    throw new Error("Invalid GitLab token");
  }

  const data = await res.json();
  return {
    id: String(data.id),
    name: data.name || data.username,
    email: data.email,
    image: data.avatar_url,
  };
}

/**
 * Dispatches token validation to the correct provider-specific handler.
 * @param token - The personal access token to validate.
 * @param provider - Which provider the token belongs to.
 * @returns The authenticated user's profile data.
 * @throws If the provider is unknown or the token is invalid.
 */
export async function validateToken(
  token: string,
  provider: TokenProvider
): Promise<ValidatedUser> {
  if (provider === "github") return validateGitHubToken(token);
  if (provider === "gitlab") return validateGitLabToken(token);
  throw new Error(`Unknown provider: ${provider}`);
}
