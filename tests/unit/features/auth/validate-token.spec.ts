/**
 * @module tests/unit/features/auth/validate-token.spec.ts
 * Unit tests for the token validation module.
 * All external fetch calls are intercepted via vi.stubGlobal.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  InvalidTokenError,
  validateGitHubToken,
  validateGitLabToken,
  validateToken,
} from "@/features/auth/validate-token";

// RCS-001: Stub the global fetch rather than mocking a module. Fetch is a
// built-in used directly inside module functions.
const mockFetch = vi.fn();

describe("validate-token", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.stubEnv("AUTH_GITLAB_URL", "https://gitlab.com");
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  describe("validateGitHubToken", () => {
    /**
     * @target validateGitHubToken
     * @dependencies fetch (stubbed)
     * @scenario GitHub API returns 200 with a well-formed user object
     * @expectedOutput A ValidatedUser with id, name, email, image populated
     */
    it("should return a ValidatedUser on a successful GitHub API response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 12345,
          login: "gracehopper",
          name: "Grace Hopper",
          email: "grace@example.com",
          avatar_url: "https://example.com/avatar.png",
        }),
      });

      const result = await validateGitHubToken("ghp_valid");

      expect(result).toEqual({
        id: "12345",
        instance: "github.com",
        name: "Grace Hopper",
        email: "grace@example.com",
        image: "https://example.com/avatar.png",
      });
    });

    /**
     * @target validateGitHubToken
     * @dependencies fetch (stubbed)
     * @scenario GitHub API returns 401 Unauthorized
     * @expectedOutput Throws an Error (not matching message text)
     */
    it("should throw when the GitHub API returns a non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      await expect(validateGitHubToken("ghp_invalid")).rejects.toThrowError(Error);
    });

    /**
     * @target validateGitHubToken
     * @dependencies fetch (stubbed)
     * @scenario name is null but login is present
     * @expectedOutput name falls back to login value
     */
    it("should fall back to login when name is null", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 99,
          login: "ghostuser",
          name: null,
          email: null,
          avatar_url: null,
        }),
      });

      const result = await validateGitHubToken("ghp_valid");
      expect(result.name).toEqual("ghostuser");
    });

    /**
     * @target validateGitHubToken
     * @dependencies fetch (stubbed)
     * @scenario GitHub rejects the token itself
     * @expectedOutput Throws InvalidTokenError, which callers treat as "this token is dead"
     */
    it("should throw InvalidTokenError when GitHub answers 401", async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
      await expect(validateGitHubToken("ghp_revoked")).rejects.toBeInstanceOf(InvalidTokenError);
    });

    /**
     * @target validateGitHubToken
     * @dependencies fetch (stubbed)
     * @scenario GitHub cannot answer (outage or rate limit)
     * @expectedOutput Throws a plain Error, which says nothing about the token
     */
    it("should throw a plain error when GitHub cannot answer", async () => {
      mockFetch.mockResolvedValueOnce(new Response(null, { status: 503 }));

      const error = await validateGitHubToken("ghp_valid").catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(InvalidTokenError);
    });

    /**
     * @target validateGitHubToken
     * @dependencies fetch (stubbed)
     * @scenario A 200 response without an account id
     * @expectedOutput Throws, so a malformed answer can never share an identity with another
     */
    it("should throw when the GitHub user has no id", async () => {
      mockFetch.mockResolvedValueOnce(
        Response.json({ login: "ghost", name: null, email: null, avatar_url: null })
      );
      await expect(validateGitHubToken("ghp_valid")).rejects.toThrowError();
    });
  });

  // ---------------------------------------------------------------------------
  describe("validateGitLabToken", () => {
    /**
     * @target validateGitLabToken
     * @dependencies fetch (stubbed), AUTH_GITLAB_URL env var
     * @scenario GitLab API returns 200 with a well-formed user object
     * @expectedOutput A ValidatedUser with id, name, email, image populated
     */
    it("should return a ValidatedUser on a successful GitLab API response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 42,
          username: "adalovelace",
          name: "Ada Lovelace",
          email: "ada@example.com",
          avatar_url: "https://example.com/ada.png",
        }),
      });

      const result = await validateGitLabToken("glpat_valid");

      expect(result).toEqual({
        id: "42",
        instance: "gitlab.com",
        name: "Ada Lovelace",
        email: "ada@example.com",
        image: "https://example.com/ada.png",
      });
    });

    /**
     * @target validateGitLabToken
     * @dependencies fetch (stubbed)
     * @scenario GitLab API returns 403 Forbidden
     * @expectedOutput Throws an Error
     */
    it("should throw when the GitLab API returns a non-ok response", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });
      await expect(validateGitLabToken("glpat_invalid")).rejects.toThrowError(Error);
    });

    /**
     * @target validateGitLabToken
     * @dependencies fetch (stubbed), AUTH_GITLAB_URL env var
     * @scenario A self-hosted GitLab served under a sub-path
     * @expectedOutput The instance names the host and path, since user ids repeat across instances
     */
    it("should name the instance from AUTH_GITLAB_URL, path included", async () => {
      vi.stubEnv("AUTH_GITLAB_URL", "https://example.com/gitlab/");
      mockFetch.mockResolvedValueOnce(
        Response.json({ id: 7, username: "ada", name: null, email: null, avatar_url: null })
      );

      const result = await validateGitLabToken("glpat_valid");

      expect(result.instance).toEqual("example.com/gitlab");
    });
  });

  // ---------------------------------------------------------------------------
  describe("validateToken (dispatcher)", () => {
    /**
     * @target validateToken
     * @dependencies fetch (stubbed)
     * @scenario provider is "github"
     * @expectedOutput Delegates to validateGitHubToken and returns its result
     */
    it("should dispatch to validateGitHubToken for github provider", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 1, login: "u", name: "U", email: null, avatar_url: null }),
      });
      const result = await validateToken("ghp_abc", "github");
      expect(result.id).toEqual("1");
    });

    /**
     * @target validateToken
     * @dependencies fetch (stubbed)
     * @scenario provider is "gitlab"
     * @expectedOutput Delegates to validateGitLabToken and returns its result
     */
    it("should dispatch to validateGitLabToken for gitlab provider", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 2, username: "v", name: "V", email: null, avatar_url: null }),
      });
      const result = await validateToken("glpat_abc", "gitlab");
      expect(result.id).toEqual("2");
    });
  });
});

// ---------------------------------------------------------------------------
describe("Network errors", () => {
  it("should throw an error on network failure for validateGitHubToken", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    await expect(validateGitHubToken("ghp_valid")).rejects.toThrow("Network error");
  });

  it("should throw an error on network failure for validateGitLabToken", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    await expect(validateGitLabToken("glpat_valid")).rejects.toThrow("Network error");
  });
});

it("should throw for unknown provider", async () => {
  await expect(validateToken("token", "unknown" as never)).rejects.toThrow(
    "Unknown provider: unknown"
  );
});

describe("GitLab edge cases", () => {
  it("should fall back to username when name is null", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        id: 42,
        username: "adalovelace",
        name: null,
        email: "ada@example.com",
        avatar_url: "https://example.com/ada.png",
      }),
    });

    const result = await validateGitLabToken("glpat_valid");
    expect(result.name).toEqual("adalovelace");
  });
});
