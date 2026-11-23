/**
 * @module tests/unit/lib/github/labels-collaborators
 *
 * `fetchLabels` and `fetchCollaborators` feed the label and assignee pickers on
 * every triage action and had no tests. Three things are worth pinning: the
 * `role_name` and access-flag mappings (a wrong map silently offers the wrong
 * people as admins), the pagination cut-off, and that a failed page releases its
 * request timer — the picker opens on a keystroke, so a leak here accumulates on
 * the path users hit most.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { githubProvider } from "@/lib/github";
import { gitlabProvider } from "@/lib/gitlab";

vi.mock("@/lib/logger", () => ({
  providerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/** A full page, so the pagination loop attempts another request. */
function fullPage<T>(make: (index: number) => T): T[] {
  return Array.from({ length: 100 }, (_, index) => make(index));
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function githubLabel(index: number) {
  return { name: `label-${index}`, color: "ff0000", description: `Label ${index}` };
}

function githubCollaborator(index: number, roleName?: string) {
  return {
    login: `user-${index}`,
    avatar_url: `https://avatars.test/${index}.png`,
    role_name: roleName,
  };
}

describe("githubProvider.fetchLabels", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * @target githubProvider.fetchLabels
   * @dependencies ghFetch, readBody
   * @scenario One short page of labels
   * @expectedOutput The normalised names, colours and descriptions, with a null
   *                 colour preserved rather than dropped, since the picker
   *                 renders a swatch from it.
   */
  it("normalises one page of labels", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([githubLabel(0), { name: "no-colour", color: null, description: null }])
      )
    );

    expect(await githubProvider.fetchLabels?.("acme", "widgets", "token")).toEqual([
      { name: "label-0", color: "ff0000", description: "Label 0" },
      { name: "no-colour", color: null, description: null },
    ]);
  });

  /**
   * @target githubProvider.fetchLabels
   * @dependencies ghFetch
   * @scenario The provider answers with more than one page
   * @expectedOutput Every page is read and concatenated. GitHub caps a page at
   *                 100, so a full page is the signal to ask for the next.
   */
  it("follows pagination until a short page", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get("page"));
      return jsonResponse(page === 1 ? fullPage(githubLabel) : [githubLabel(100)]);
    });
    vi.stubGlobal("fetch", fetchMock);

    const labels = await githubProvider.fetchLabels?.("acme", "widgets", "token");

    expect(labels).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(labels?.at(-1)).toEqual({
      name: "label-100",
      color: "ff0000",
      description: "Label 100",
    });
  });

  /**
   * @target githubProvider.fetchLabels
   * @dependencies ghFetch:!res.ok
   * @scenario The token cannot read the repository
   * @expectedOutput The labels read so far, and no request armed after the
   *                 failure. A partial list is the honest answer here because the
   *                 picker also offers labels the issue already carries.
   */
  it("stops at a failed page and leaks no timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 }))
    );

    const labels = await githubProvider.fetchLabels?.("acme", "widgets", "token");

    expect(labels).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * @target githubProvider.fetchLabels
   * @dependencies ghFetch
   * @scenario The repository has no labels
   * @expectedOutput An empty array from a single request, not a second one.
   */
  it("stops on an empty first page", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    expect(await githubProvider.fetchLabels?.("acme", "widgets", "token")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("githubProvider.fetchCollaborators", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * @target githubProvider.fetchCollaborators
   * @dependencies ghFetch, readBody
   * @scenario Collaborators carrying each role GitHub reports
   * @expectedOutput `admin` stays admin, `maintain` maps down to write, and an
   *                 absent role reads as read. Offering a maintainer as an admin
   *                 would misrepresent what they can do.
   */
  it("maps GitHub role names to permissions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          githubCollaborator(0, "admin"),
          githubCollaborator(1, "maintain"),
          githubCollaborator(2, "write"),
          githubCollaborator(3, "read"),
          githubCollaborator(4, undefined),
        ])
      )
    );

    const collaborators = await githubProvider.fetchCollaborators?.("acme", "widgets", "token");

    expect(collaborators?.map((entry) => entry.permission)).toEqual([
      "admin",
      "write",
      "write",
      "read",
      "read",
    ]);
    expect(collaborators?.[0]).toEqual({
      username: "user-0",
      avatar: "https://avatars.test/0.png",
      permission: "admin",
    });
  });

  it("follows pagination until a short page", async () => {
    const fetchMock = vi.fn(async (input: string) => {
      const page = Number(new URL(input).searchParams.get("page"));
      return jsonResponse(page === 1 ? fullPage((i) => githubCollaborator(i, "write")) : []);
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await githubProvider.fetchCollaborators?.("acme", "widgets", "token")).toHaveLength(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  /**
   * @target githubProvider.fetchCollaborators
   * @dependencies ghFetch:!res.ok
   * @scenario The provider rejects the read
   * @expectedOutput An empty list and no armed timer. The assignee picker then
   *                 offers nobody, which is at least not a wrong list.
   */
  it("reports nothing and leaks no timer on a failed read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 }))
    );

    expect(await githubProvider.fetchCollaborators?.("acme", "widgets", "token")).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("gitlabProvider.fetchLabels", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * @target gitlabProvider.fetchLabels
   * @dependencies timedFetch, readJson
   * @scenario GitLab returns colours with a leading `#`
   * @expectedOutput The `#` stripped, so both providers hand the UI the same
   *                 shape. A picker that pasted the raw value would produce an
   *                 invalid CSS colour on the GitLab side only.
   */
  it("strips the leading hash from colours", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          { name: "bug", color: "#d73a4a", description: "Something is broken" },
          { name: "no-colour", color: null, description: null },
        ])
      )
    );

    expect(await gitlabProvider.fetchLabels?.("group", "app", "token")).toEqual([
      { name: "bug", color: "d73a4a", description: "Something is broken" },
      { name: "no-colour", color: null, description: null },
    ]);
  });

  /**
   * @target gitlabProvider.fetchLabels
   * @dependencies timedFetch
   * @scenario The project path contains a namespace
   * @expectedOutput The path is URL-encoded as one segment, as GitLab requires;
   *                 an unencoded slash would request a different resource.
   */
  it("encodes the project path into the request", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        requested.push(input);
        return jsonResponse([]);
      })
    );

    await gitlabProvider.fetchLabels?.("group", "app", "token");

    expect(new URL(requested[0]).pathname).toBe("/api/v4/projects/group%2Fapp/labels");
  });

  it("stops at a failed page and leaks no timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 401 }))
    );

    expect(await gitlabProvider.fetchLabels?.("group", "app", "token")).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("gitlabProvider.fetchCollaborators", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * @target gitlabProvider.fetchCollaborators
   * @dependencies timedFetch, readJson
   * @scenario Members carrying each access level
   * @expectedOutput 40+ maps to admin and 30+ to write, matching the mapping
   *                 `getRepoPermission` uses, so a member shown as a maintainer
   *                 here can actually write there.
   */
  it("maps access levels to permissions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse([
          { access_level: 50, username: "owner", avatar_url: null },
          { access_level: 40, username: "maintainer", avatar_url: "https://x.test/m.png" },
          { access_level: 30, username: "developer", avatar_url: null },
          { access_level: 20, username: "reporter", avatar_url: null },
        ])
      )
    );

    const collaborators = await gitlabProvider.fetchCollaborators?.("group", "app", "token");

    expect(collaborators?.map((entry) => [entry.username, entry.permission])).toEqual([
      ["owner", "admin"],
      ["maintainer", "admin"],
      ["developer", "write"],
      ["reporter", "read"],
    ]);
    expect(collaborators?.[1].avatar).toBe("https://x.test/m.png");
  });

  /**
   * @target gitlabProvider.fetchCollaborators
   * @dependencies timedFetch
   * @scenario The read is asked for members including inherited ones
   * @expectedOutput The `/members/all` endpoint, not `/members`, so a group-level
   *                 maintainer is assignable on a project they were never added to
   */
  it("asks for inherited members", async () => {
    const requested: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        requested.push(input);
        return jsonResponse([]);
      })
    );

    await gitlabProvider.fetchCollaborators?.("group", "app", "token");

    expect(new URL(requested[0]).pathname).toBe("/api/v4/projects/group%2Fapp/members/all");
  });

  it("reports nothing and leaks no timer on a failed read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 }))
    );

    expect(await gitlabProvider.fetchCollaborators?.("group", "app", "token")).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
