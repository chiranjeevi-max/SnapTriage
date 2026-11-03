/**
 * @module tests/unit/lib/gitlab/client.test.ts
 * What `gitlabProvider.updateIssue` writes back, against a fake GitLab API
 * that records every request.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { gitlabProvider } from "@/lib/gitlab";
import { ProviderApiError } from "@/lib/provider-error";

/** A user as GitLab's issue payloads and users API return it. */
function gitlabUser(id: number, username: string) {
  return {
    id,
    username,
    name: username,
    state: "active",
    avatar_url: `https://gitlab.com/uploads/-/system/user/avatar/${id}/avatar.png`,
    web_url: `https://gitlab.com/${username}`,
  };
}

/** The issue every test edits: assigned to alice and bob, labelled `wontfix`. */
const issue = {
  id: 9001,
  iid: 5,
  project_id: 42,
  title: "Crash on save",
  state: "opened",
  labels: ["wontfix"],
  assignee: gitlabUser(1, "alice"),
  assignees: [gitlabUser(1, "alice"), gitlabUser(2, "bob")],
  web_url: "https://gitlab.com/group/app/-/issues/5",
};

const ISSUE_PATH = "/api/v4/projects/group%2Fapp/issues/5";

/**
 * Fakes the endpoints `updateIssue` may call and records each request.
 * `users` maps a username to its search result, or to an HTTP status.
 */
function fakeGitLab(
  users: Record<string, ReturnType<typeof gitlabUser>[] | number>,
  issuePayload: object = issue
) {
  const requests: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input);
      const method = init?.method ?? "GET";
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      requests.push({ method, path: url.pathname + url.search, body });

      if (url.pathname === "/api/v4/users") {
        const found = users[url.searchParams.get("username") ?? ""] ?? [];
        return typeof found === "number"
          ? new Response(null, { status: found })
          : Response.json(found);
      }
      if (url.pathname === ISSUE_PATH) return Response.json(issuePayload);
      return new Response(null, { status: 404 });
    })
  );
  return requests;
}

describe("gitlabProvider.updateIssue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps the current assignees when adding others", async () => {
    // Looking up alice or bob would fail; their ids already come with the issue.
    const requests = fakeGitLab({ alice: 503, bob: 503, carol: [gitlabUser(3, "carol")] });

    await gitlabProvider.updateIssue("group", "app", 5, "glpat-token", {
      assignees: { add: ["alice", "carol"] },
    });

    expect(requests.at(-1)).toEqual({
      method: "PUT",
      path: ISSUE_PATH,
      body: { assignee_ids: "1,2,3" },
    });
  });

  it("removes an assignee without unassigning the others", async () => {
    const requests = fakeGitLab({ alice: 503, bob: 503 });

    await gitlabProvider.updateIssue("group", "app", 5, "glpat-token", {
      assignees: { remove: ["bob"] },
    });

    expect(requests.at(-1)).toEqual({
      method: "PUT",
      path: ISSUE_PATH,
      body: { assignee_ids: "1" },
    });
  });

  it("fails without writing when an added user does not exist", async () => {
    const requests = fakeGitLab({ ghost: [] });

    const update = gitlabProvider.updateIssue("group", "app", 5, "glpat-token", {
      assignees: { add: ["ghost"] },
    });

    await expect(update).rejects.toThrow("GitLab has no user named ghost");
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });

  it("fails without writing when looking up an added user fails", async () => {
    const requests = fakeGitLab({ flaky: 503 });

    const error = await gitlabProvider
      .updateIssue("group", "app", 5, "glpat-token", { assignees: { add: ["flaky"] } })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ProviderApiError);
    expect(error).toMatchObject({ status: 503 });
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });

  it("fails without writing when the issue comes back without its assignees", async () => {
    const requests = fakeGitLab({ carol: [gitlabUser(3, "carol")] }, { ...issue, assignees: null });

    const update = gitlabProvider.updateIssue("group", "app", 5, "glpat-token", {
      assignees: { add: ["carol"] },
    });

    await expect(update).rejects.toThrow("GitLab returned an issue in an unexpected shape");
    expect(requests.some((request) => request.method === "PUT")).toBe(false);
  });

  it("sends label changes as deltas without reading the issue first", async () => {
    const requests = fakeGitLab({});

    await gitlabProvider.updateIssue("group", "app", 5, "glpat-token", {
      labels: { add: ["bug"], remove: ["wontfix"] },
    });

    expect(requests).toEqual([
      { method: "PUT", path: ISSUE_PATH, body: { add_labels: "bug", remove_labels: "wontfix" } },
    ]);
  });

  it("refuses a label name with a comma instead of letting GitLab split it", async () => {
    const requests = fakeGitLab({});

    const update = gitlabProvider.updateIssue("group", "app", 5, "glpat-token", {
      labels: { remove: ["bug,security"] },
    });

    await expect(update).rejects.toThrow("GitLab label names cannot contain commas");
    expect(requests).toEqual([]);
  });
});
