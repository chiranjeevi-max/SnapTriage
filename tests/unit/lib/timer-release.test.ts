/**
 * @module tests/unit/lib/timer-release.test.ts
 *
 * A provider call is wrapped in a timer that aborts it if the response stalls.
 * The timer is released by reading the body through the adapter's helper, so
 * every path that reads a body must go through one — including the error paths,
 * which read a body only to quote it in the thrown error. A path that calls
 * `res.text()` directly leaves one armed timer per failed call, up to the
 * request timeout.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { gitlabProvider } from "@/lib/gitlab";
import { githubProvider } from "@/lib/github";

// The pretty-print transport holds its own timer on a worker thread, which would
// be counted against the code under test.
vi.mock("@/lib/logger", () => ({
  providerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** An error response whose body can still be read. */
function errorResponse(status: number, text: string) {
  return new Response(text, { status, headers: { "Content-Type": "application/json" } });
}

describe("provider timer release on error paths", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * @target gitlabProvider.fetchIssues
   * @dependencies timedFetch, readText
   * @scenario The project answers 404 and the body is read for the error message
   * @expectedOutput The error still carries the body, and no timer is left armed.
   *                 Reading it with `res.text()` directly leaked one timer per
   *                 failed call.
   */
  it("releases GitLab's timer when an issue fetch fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(404, '{"message":"404 Project Not Found"}'))
    );

    const failure = await gitlabProvider
      .fetchIssues("group", "app", "glpat-token")
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      status: 404,
      responseBody: expect.stringContaining("404 Project Not Found") as unknown as string,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * @target gitlabProvider.createComment
   * @dependencies timedFetch, readText
   * @scenario The note cannot be published
   * @expectedOutput The body is quoted and the timer is released.
   */
  it("releases GitLab's timer when publishing a comment fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(403, '{"message":"403 Forbidden"}'))
    );

    const failure = await gitlabProvider.createComment!(
      "group",
      "app",
      5,
      "glpat-token",
      "hello"
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      status: 403,
      responseBody: expect.stringContaining("403 Forbidden") as unknown as string,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * @target gitlabProvider.updateIssue
   * @dependencies timedFetch, readText
   * @scenario The issue update is rejected
   * @expectedOutput The timer is released. This is the third distinct GitLab
   *                 error path that read the body directly.
   */
  it("releases GitLab's timer when an issue update fails", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(400, '{"message":"400 Bad Request"}'))
    );

    const failure = await gitlabProvider
      .updateIssue("group", "app", 5, "glpat-token", { state: "closed" })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      status: 400,
      responseBody: expect.stringContaining("400 Bad Request") as unknown as string,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * @target githubProvider.getRepoPermission
   * @dependencies ghFetch, readBody
   * @scenario The user endpoint answers with no login
   * @expectedOutput `null`, and no request to `/collaborators/undefined/...`.
   *                 Interpolating the absent login asked for a permission on a
   *                 user that does not exist, whose 404 then read as "repository
   *                 not found" for a repository the token can see.
   */
  it("stops GitHub permission lookup when the user has no login", async () => {
    const mockFetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/user")) return Response.json({});
      return errorResponse(404, "not found");
    });
    vi.stubGlobal("fetch", mockFetch);

    await expect(githubProvider.getRepoPermission("acme", "widgets", "token")).resolves.toBeNull();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(String(mockFetch.mock.calls[0][0])).not.toContain("undefined");
  });

  /**
   * @target githubProvider.getRepoPermission
   * @dependencies ghFetch, readBody
   * @scenario The user endpoint succeeds and the permission is readable
   * @expectedOutput The mapped permission, so the guard above does not break the
   *                 working path.
   */
  it("still resolves a GitHub permission", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url.endsWith("/user")) return Response.json({ login: "octocat" });
        return Response.json({ permission: "maintain" });
      })
    );

    await expect(githubProvider.getRepoPermission("acme", "widgets", "token")).resolves.toBe(
      "write"
    );
  });
});
