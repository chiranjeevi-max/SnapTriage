/**
 * @module tests/unit/lib/github/update-issue
 *
 * `githubProvider.updateIssue` writes every live triage change on GitHub and had
 * no test at all. Two properties are easy to get wrong and invisible until
 * production: the request must declare its body as JSON, and every response must
 * release the request's abort timer.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { githubProvider } from "@/lib/github";
import { ProviderApiError } from "@/lib/provider-error";

vi.mock("@/lib/logger", () => ({
  providerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface RecordedRequest {
  method: string;
  url: string;
  contentType: string | undefined;
  body: unknown;
}

/** Fakes the GitHub endpoints `updateIssue` calls and records each request. */
function fakeGitHub() {
  const requests: RecordedRequest[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const requestHeaders = (init?.headers ?? {}) as Record<string, string>;

      requests.push({
        method: init?.method ?? "GET",
        url: new URL(url).pathname,
        contentType: requestHeaders["Content-Type"],
        // A body read here would be the joinpoint: the test asserts on what the
        // adapter sent, and the response body is never consumed by the adapter.
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    })
  );

  return requests;
}

describe("githubProvider.updateIssue", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * @target githubProvider.updateIssue
   * @dependencies fetch
   * @scenario Closing an issue
   * @expectedOutput A PATCH carrying `{ state }`, declared as JSON. Without the
   *                 explicit header `fetch` stamps `text/plain`, which GitHub
   *                 does not parse as JSON, so the write is rejected.
   */
  it("patches the state with a JSON body", async () => {
    const requests = fakeGitHub();

    await githubProvider.updateIssue("acme", "widgets", 7, "token", { state: "closed" });

    expect(requests).toEqual([
      {
        method: "PATCH",
        url: "/repos/acme/widgets/issues/7",
        contentType: "application/json",
        body: { state: "closed" },
      },
    ]);
  });

  /**
   * @target githubProvider.updateIssue
   * @dependencies fetch
   * @scenario Adding labels
   * @expectedOutput A POST to the labels endpoint with the names.
   */
  it("posts added labels", async () => {
    const requests = fakeGitHub();

    await githubProvider.updateIssue("acme", "widgets", 7, "token", {
      labels: { add: ["bug", "p1"] },
    });

    expect(requests).toEqual([
      expect.objectContaining({
        method: "POST",
        url: "/repos/acme/widgets/issues/7/labels",
        contentType: "application/json",
        body: { labels: ["bug", "p1"] },
      }),
    ]);
  });

  /**
   * @target githubProvider.updateIssue
   * @dependencies fetch
   * @scenario Removing labels
   * @expectedOutput One DELETE per label, URL-encoded, with no body
   */
  it("deletes each removed label by name", async () => {
    const requests = fakeGitHub();

    await githubProvider.updateIssue("acme", "widgets", 7, "token", {
      labels: { remove: ["needs triage", "wontfix"] },
    });

    expect(requests.map((request) => [request.method, request.url])).toEqual([
      ["DELETE", "/repos/acme/widgets/issues/7/labels/needs%20triage"],
      ["DELETE", "/repos/acme/widgets/issues/7/labels/wontfix"],
    ]);
    // No body means no content type, which is correct for this endpoint.
    expect(requests.every((request) => request.contentType === undefined)).toBe(true);
  });

  /**
   * @target githubProvider.updateIssue
   * @dependencies fetch
   * @scenario Removing one assignee
   * @expectedOutput A DELETE whose JSON body names that assignee. Without the
   *                 content type GitHub ignores the body and unassigns everyone.
   */
  it("removes only the named assignee", async () => {
    const requests = fakeGitHub();

    await githubProvider.updateIssue("acme", "widgets", 7, "token", {
      assignees: { remove: ["octocat"] },
    });

    expect(requests).toEqual([
      {
        method: "DELETE",
        url: "/repos/acme/widgets/issues/7/assignees",
        contentType: "application/json",
        body: { assignees: ["octocat"] },
      },
    ]);
  });

  /**
   * @target githubProvider.updateIssue
   * @dependencies fetch
   * @scenario A combined write: close, label, assign
   * @expectedOutput Three requests in a stable order, so a partial failure is
   *                 predictable rather than dependent on object key order.
   */
  it("sends each part of a combined write separately", async () => {
    const requests = fakeGitHub();

    await githubProvider.updateIssue("acme", "widgets", 7, "token", {
      state: "closed",
      labels: { add: ["bug"] },
      assignees: { add: ["octocat"] },
    });

    expect(requests.map((request) => request.url)).toEqual([
      "/repos/acme/widgets/issues/7",
      "/repos/acme/widgets/issues/7/labels",
      "/repos/acme/widgets/issues/7/assignees",
    ]);
  });

  /**
   * @target githubProvider.updateIssue
   * @dependencies ghFetch, discard
   * @scenario A write is accepted
   * @expectedOutput No timer is left armed. The success path returned the
   *                 response without reading or releasing it, leaking one timer
   *                 per accepted write.
   */
  it("leaves no timer armed after an accepted write", async () => {
    vi.useFakeTimers();
    fakeGitHub();

    await githubProvider.updateIssue("acme", "widgets", 7, "token", {
      state: "closed",
      labels: { add: ["bug"] },
      assignees: { add: ["octocat"] },
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * @target githubProvider.updateIssue
   * @dependencies ghFetch, readText
   * @scenario The provider rejects the write
   * @expectedOutput A `ProviderApiError` carrying the status, with no timer left
   *                 armed. The error path read the body directly, leaking one.
   */
  it("reports a rejection and leaves no timer armed", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response('{"message":"Validation Failed"}', { status: 422 }))
    );

    const failure = await githubProvider
      .updateIssue("acme", "widgets", 7, "token", { state: "closed" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ProviderApiError);
    expect(failure).toMatchObject({ status: 422 });
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * @target githubProvider.updateIssue
   * @dependencies fetch
   * @scenario Nothing to change
   * @expectedOutput No request at all, so an empty patch cannot clear a field
   */
  it("sends nothing when there is nothing to change", async () => {
    const requests = fakeGitHub();

    await githubProvider.updateIssue("acme", "widgets", 7, "token", {});

    expect(requests).toEqual([]);
  });
});
