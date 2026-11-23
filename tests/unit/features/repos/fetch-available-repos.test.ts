/**
 * @module tests/unit/features/repos/fetch-available-repos
 *
 * Browsing a provider for connectable repositories. Untested until now, and two
 * properties are worth pinning: the request deadline has to cover the body read,
 * and one malformed project must not discard the pages already collected.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import {
  fetchAvailableRepos,
  fetchGitHubRepos,
  fetchGitLabRepos,
} from "@/features/repos/fetch-available-repos";

vi.mock("@/lib/logger", () => ({
  providerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function githubRepo(overrides: Record<string, unknown> = {}) {
  return {
    name: "widgets",
    full_name: "acme/widgets",
    description: "Widgets",
    private: false,
    permissions: { admin: false, push: true },
    owner: { login: "acme" },
    ...overrides,
  };
}

function gitlabProject(overrides: Record<string, unknown> = {}) {
  return {
    path: "widgets",
    path_with_namespace: "acme/widgets",
    description: "Widgets",
    visibility: "private",
    namespace: { path: "acme" },
    permissions: { project_access: { access_level: 30 } },
    ...overrides,
  };
}

describe("fetchAvailableRepos", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * @target fetchGitHubRepos
   * @dependencies fetchWithTimeout, readJson
   * @scenario GitHub sends headers and then stalls the body
   * @expectedOutput The call rejects. The timer used to be cleared in a `finally`
   *                 the moment `fetch` resolved, leaving `res.json()` with no
   *                 deadline at all, so a stalled body held the request forever.
   */
  it("keeps its deadline while the body is being read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo, init?: RequestInit) => {
        const signal = init?.signal as AbortSignal;
        return {
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              if (signal.aborted) return reject(new Error("aborted"));
              signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            }),
        } as unknown as Response;
      })
    );

    let settled: "resolved" | "rejected" | null = null;
    void fetchGitHubRepos("token").then(
      () => {
        settled = "resolved";
      },
      () => {
        settled = "rejected";
      }
    );

    await vi.advanceTimersByTimeAsync(31_000);

    expect(settled).toBe("rejected");
  });

  /**
   * @target fetchGitHubRepos
   * @dependencies fetch
   * @scenario A project's namespace is missing, as GitLab reports for a project
   *           the token can no longer see in full
   * @expectedOutput The project still appears with an owner derived from its full
   *                 path, instead of throwing and discarding every page already
   *                 collected.
   */
  it("falls back to the full path when a GitLab namespace is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([gitlabProject({ namespace: null })]))
    );

    const repos = await fetchGitLabRepos("glpat-token");

    expect(repos).toEqual([
      expect.objectContaining({ owner: "acme", name: "widgets", fullName: "acme/widgets" }),
    ]);
  });

  /**
   * @target fetchGitLabRepos
   * @dependencies fetch
   * @scenario A subgroup project has no namespace, on the page after a normal one
   * @expectedOutput The owner keeps every leading segment, and the earlier page
   *                 survives. Reading only the first segment turned
   *                 `group/sub/app` into `group`, which the connect flow cannot
   *                 resolve; a throw here would also drop the page already read.
   */
  it("keeps subgroup segments and earlier pages when a namespace is missing", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      gitlabProject({ path: `p${index}`, path_with_namespace: `group/p${index}` })
    );
    const secondPage = [
      gitlabProject({ path: "app", path_with_namespace: "group/sub/app", namespace: null }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const page = Number(new URL(input).searchParams.get("page"));
        return Response.json(page === 1 ? firstPage : secondPage);
      })
    );

    const repos = await fetchGitLabRepos("glpat-token");

    expect(repos).toHaveLength(101);
    expect(repos.at(-1)).toEqual(
      expect.objectContaining({ owner: "group/sub", name: "app", fullName: "group/sub/app" })
    );
    expect(repos[0]).toEqual(expect.objectContaining({ fullName: "group/p0" }));
  });

  /**
   * @target fetchGitHubRepos
   * @dependencies fetchWithTimeout
   * @scenario GitHub answers with an error status
   * @expectedOutput A thrown error carrying the status, and no leaked timer.
   */
  it("throws on an error response without leaking its timer", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 }))
    );

    await expect(fetchGitHubRepos("bad-token")).rejects.toThrow("HTTP 401");
    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * @target fetchGitHubRepos
   * @dependencies fetchWithTimeout
   * @scenario A successful read finishes normally
   * @expectedOutput The timer is released rather than left armed until it fires.
   */
  it("releases its timer after a successful read", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([githubRepo()]))
    );

    await fetchGitHubRepos("token");

    expect(vi.getTimerCount()).toBe(0);
  });

  /**
   * @target fetchAvailableRepos
   * @dependencies fetchGitHubRepos, fetchGitLabRepos
   * @scenario Each provider is asked for its repositories
   * @expectedOutput The matching normaliser is used, with the access flags mapped
   *                 to the shared permission vocabulary.
   */
  it("dispatches to the provider's own normaliser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json([githubRepo()]))
    );

    const [github] = await fetchAvailableRepos("token", "github");

    expect(github).toMatchObject({ provider: "github", permission: "write", isPrivate: false });
  });

  /**
   * @target fetchGitLabRepos
   * @dependencies fetch
   * @scenario A project the user maintains versus one they only report on
   * @expectedOutput Access levels 40+ map to admin and 30+ to write, matching the
   *                 adapter's own mapping so the permission shown here is the
   *                 permission triage will honour.
   */
  it("maps GitLab access levels to permissions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json([
          gitlabProject({
            path: "owned",
            path_with_namespace: "acme/owned",
            permissions: { project_access: { access_level: 40 } },
          }),
          gitlabProject({
            path: "reported",
            path_with_namespace: "acme/reported",
            permissions: { project_access: { access_level: 20 } },
          }),
        ])
      )
    );

    const repos = await fetchGitLabRepos("glpat-token");

    expect(repos.map((repo) => repo.permission)).toEqual(["admin", "read"]);
  });
});
