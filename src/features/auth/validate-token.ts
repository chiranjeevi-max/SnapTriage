/**
 * @module auth/validate-token
 *
 * Validates Personal Access Tokens against GitHub or GitLab APIs.
 *
 * Used during the PAT sign-in flow: the token is sent to the provider's
 * "get current user" endpoint to verify it's valid and extract user profile data.
 */
import { z } from "zod";

/** Supported provider identifiers for PAT validation. */
export type TokenProvider = "github" | "gitlab";

/** Profile data extracted from a successful token validation. */
export interface ValidatedUser {
  id: string;
  /** The instance that issued the account, as host and optional path. Ids repeat across instances. */
  instance: string;
  name: string;
  email: string | null;
  image: string | null;
}

/** The fields of GitHub's `GET /user` read here. */
const githubUserSchema = z.object({
  id: z.number(),
  login: z.string(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

/** The fields of GitLab's `GET /api/v4/user` read here. */
const gitlabUserSchema = z.object({
  id: z.number(),
  username: z.string(),
  name: z.string().nullish(),
  email: z.string().nullish(),
  avatar_url: z.string().nullish(),
});

/**
 * Raised when the provider rejects the token itself (HTTP 401).
 *
 * Kept apart from other failures: an outage or a rate limit says nothing
 * about whether the token is still good.
 */
export class InvalidTokenError extends Error {
  constructor(provider: TokenProvider) {
    super(`Invalid ${provider === "github" ? "GitHub" : "GitLab"} token`);
    this.name = "InvalidTokenError";
  }
}

/**
 * Validates a GitHub PAT by calling the `/user` endpoint.
 * @param token - GitHub personal access token.
 * @returns The authenticated user's profile data.
 * @throws {InvalidTokenError} If GitHub rejects the token.
 * @throws {Error} If the check itself fails.
 */
export async function validateGitHubToken(token: string): Promise<ValidatedUser> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch("https://api.github.com/user", {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 401) throw new InvalidTokenError("github");
    if (!res.ok) throw new Error(`GitHub token check failed with HTTP ${res.status}`);

    const data = githubUserSchema.parse(await res.json());
    return {
      id: String(data.id),
      instance: "github.com",
      name: data.name || data.login,
      email: data.email ?? null,
      image: data.avatar_url ?? null,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Validates a GitLab PAT by calling the `/api/v4/user` endpoint.
 * Supports self-hosted GitLab via `AUTH_GITLAB_URL` env var.
 * @param token - GitLab personal access token.
 * @returns The authenticated user's profile data.
 * @throws {InvalidTokenError} If GitLab rejects the token.
 * @throws {Error} If the check itself fails.
 */
export async function validateGitLabToken(token: string): Promise<ValidatedUser> {
  const baseUrl = process.env.AUTH_GITLAB_URL || "https://gitlab.com";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${baseUrl}/api/v4/user`, {
      headers: { "PRIVATE-TOKEN": token },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (res.status === 401) throw new InvalidTokenError("gitlab");
    if (!res.ok) throw new Error(`GitLab token check failed with HTTP ${res.status}`);

    const data = gitlabUserSchema.parse(await res.json());
    const { host, pathname } = new URL(baseUrl);
    return {
      id: String(data.id),
      instance: host + pathname.replace(/\/+$/, ""),
      name: data.name || data.username,
      email: data.email ?? null,
      image: data.avatar_url ?? null,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
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
