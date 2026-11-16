/**
 * @module tests/unit/lib/comment-adapters
 *
 * The comment half of the two provider adapters, tested against a mocked
 * `fetch` rather than against the modules that call it.
 *
 * Three normalisations are the reason this file exists, because each is a place
 * where the two providers genuinely disagree and a caller must not have to know:
 *
 * - **Page direction.** GitHub numbers comment pages ascending from the oldest,
 *   so reading the newest page costs a probe for the `Link` header's `rel="last"`.
 *   GitLab pages newest-first and exposes `x-next-page`. Both are normalised to
 *   "oldest first within the page, cursor walks older".
 * - **System records.** GitHub keeps generated timeline activity out of the
 *   comment stream; GitLab returns it inline. A reused "added label" would
 *   otherwise read as a reply, so `isSystem` has to be right on both.
 * - **Filtered reads.** A `since` read is "the oldest page of a small filtered
 *   set" and must cost exactly one request, because it is what the follow-up
 *   check runs per issue.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { githubProvider } from "@/lib/github";
import { gitlabProvider } from "@/lib/gitlab";
import { ProviderApiError } from "@/lib/provider-error";

vi.mock("@/lib/logger", () => ({
  providerLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const GITHUB_COMMENTS_URL = "https://api.github.com/repos/octo/repo/issues/7/comments";
const GITLAB_NOTES_URL = "https://gitlab.com/api/v4/projects/octo%2Frepo/issues/7/notes";

/** A GitHub comment payload, as the REST API returns one. */
function githubComment(overrides: Record<string, unknown> = {}) {
  return {
    id: 1001,
    body: "Any update on this?",
    user: { login: "nadia", avatar_url: "https://avatars.test/nadia.png" },
    created_at: "2026-02-01T10:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    html_url: "https://github.com/octo/repo/issues/7#issuecomment-1001",
    ...overrides,
  };
}

/** A GitLab note payload, as the REST API returns one. */
function gitlabNote(overrides: Record<string, unknown> = {}) {
  return {
    id: 2002,
    body: "Still seeing this on 2.1.",
    author: { username: "nadia", avatar_url: null },
    created_at: "2026-02-01T10:00:00Z",
    updated_at: "2026-02-01T10:00:00Z",
    system: false,
    ...overrides,
  };
}

/** Build a JSON response, with optional headers. */
function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {}
) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

/** Build an error response, as a provider would. */
function errorResponse(status: number, text = "nope") {
  return new Response(text, { status });
}

/** The URLs the adapter asked for, in order. */
function requestedUrls(): string[] {
  return vi.mocked(fetch).mock.calls.map(([url]) => String(url));
}

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("githubProvider.fetchComments", () => {
  /**
   * @target githubProvider.fetchComments
   * @dependencies fetch
   * @scenario GitHub reports a single page, so its Link header has no `rel="last"`
   * @expectedOutput One request, no older cursor, and the comment normalised
   */
  it("should make one request and return no cursor for a single page", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([githubComment()]));

    const page = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(page?.olderCursor).toBeNull();
    expect(page?.comments).toEqual([
      {
        id: "1001",
        body: "Any update on this?",
        author: "nadia",
        authorAvatar: "https://avatars.test/nadia.png",
        createdAt: new Date("2026-02-01T10:00:00Z"),
        updatedAt: new Date("2026-02-01T10:00:00Z"),
        isSystem: false,
        url: "https://github.com/octo/repo/issues/7#issuecomment-1001",
      },
    ]);
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies fetch
   * @scenario The Link header numbering ends at page 4
   * @expectedOutput A probe of page 1, then page 4, with `olderCursor` at 3
   */
  it("should probe page 1 then read the last page when several exist", async () => {
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse([githubComment({ id: 1, body: "Oldest" })], {
          headers: {
            link: `<${GITHUB_COMMENTS_URL}?per_page=30&page=2>; rel="next", <${GITHUB_COMMENTS_URL}?per_page=30&page=4>; rel="last"`,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse([githubComment({ id: 400, body: "Newest" })], {
          headers: {
            link: `<${GITHUB_COMMENTS_URL}?per_page=30&page=3>; rel="prev"`,
          },
        })
      );

    const page = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc");

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(requestedUrls()[0]).toContain("page=1");
    expect(requestedUrls()[1]).toContain("page=4");
    expect(page?.comments.map((comment) => comment.body)).toEqual(["Newest"]);
    expect(page?.olderCursor).toBe("3");
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies fetch
   * @scenario The follow-up check asks for what changed since a baseline
   * @expectedOutput Exactly one request, with `since` on it and no cursor: the
   *                 filtered set is small, so its oldest page already answers
   */
  it("should make exactly one request when a since filter is given", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([githubComment()], {
        headers: {
          link: `<${GITHUB_COMMENTS_URL}?per_page=30&page=2>; rel="next", <${GITHUB_COMMENTS_URL}?per_page=30&page=4>; rel="last"`,
        },
      })
    );

    const page = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc", {
      since: new Date("2026-01-31T00:00:00Z"),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestedUrls()[0]).toContain("since=2026-01-31T00%3A00%3A00.000Z");
    expect(requestedUrls()[0]).toContain("page=1");
    // A filtered set can span pages. Reporting no cursor here let a run of the
    // user's own comments push a qualifying reply past the first page, where the
    // follow-up check never looked.
    expect(page?.olderCursor).toBe("2");
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies fetch
   * @scenario A `since` filter whose filtered set fits on one page
   * @expectedOutput One request and no cursor, so the caller does not walk
   *                 pages that do not exist
   */
  it("should report no cursor when a since filter fits on one page", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([githubComment()]));

    const page = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc", {
      since: new Date("2026-01-31T00:00:00Z"),
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(page?.olderCursor).toBeNull();
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies fetch
   * @scenario A cursor from a previous call is supplied
   * @expectedOutput One request for that page, with the cursor walked one older
   */
  it("should read the cursor page and walk one page older", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([githubComment()]));

    const page = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc", {
      cursor: "4",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(requestedUrls()[0]).toContain("page=4");
    expect(page?.olderCursor).toBe("3");
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies fetch
   * @scenario The oldest page is reached, so page 1 has no older neighbour
   * @expectedOutput `olderCursor: null`, which is what stops the pane offering
   *                 a "load older" that would fetch nothing
   */
  it("should report no older cursor at the oldest page", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([githubComment()]));

    const page = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc", {
      cursor: "1",
    });

    expect(page?.olderCursor).toBeNull();
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies ProviderApiError
   * @scenario The cursor is not a positive integer
   * @expectedOutput `ProviderApiError` before any request is made, so a
   *                 corrupt cursor fails loudly instead of reading page `NaN`
   */
  it("should throw for an invalid cursor without calling the provider", async () => {
    await expect(
      githubProvider.fetchComments?.("octo", "repo", 7, "token-abc", { cursor: "abc" })
    ).rejects.toBeInstanceOf(ProviderApiError);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies ProviderApiError
   * @scenario GitHub answers 500
   * @expectedOutput `ProviderApiError` carrying the status and the operation
   */
  it("should throw a provider error on a non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, "boom"));

    await expect(
      githubProvider.fetchComments?.("octo", "repo", 7, "token-abc")
    ).rejects.toMatchObject({ status: 500, operation: "fetchComments", provider: "github" });
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies fetch
   * @scenario A `since` result spans three pages, walked by cursor
   * @expectedOutput The cursor advances 2, then 3, then stops. Walking it
   *                 backwards returns to page 1 and never reads page 3, so a
   *                 reply on the last page stays unread.
   */
  it("should walk since-filtered pages forwards to the end", async () => {
    const since = new Date("2026-01-01T00:00:00.000Z");
    mockFetch
      .mockResolvedValueOnce(
        jsonResponse([githubComment({ id: 1, body: "One" })], {
          headers: {
            link: `<${GITHUB_COMMENTS_URL}?per_page=30&page=2>; rel="next", <${GITHUB_COMMENTS_URL}?per_page=30&page=3>; rel="last"`,
          },
        })
      )
      .mockResolvedValueOnce(
        jsonResponse([githubComment({ id: 2, body: "Two" })], {
          headers: {
            link: `<${GITHUB_COMMENTS_URL}?per_page=30&page=3>; rel="next"`,
          },
        })
      )
      .mockResolvedValueOnce(jsonResponse([githubComment({ id: 3, body: "Three" })]));

    const first = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc", { since });
    expect(first?.olderCursor).toBe("2");

    const second = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc", {
      since,
      cursor: "2",
    });
    expect(second?.olderCursor).toBe("3");
    expect(second?.comments.map((comment) => comment.body)).toEqual(["Two"]);

    const third = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc", {
      since,
      cursor: "3",
    });
    expect(third?.olderCursor).toBeNull();
    expect(third?.comments.map((comment) => comment.body)).toEqual(["Three"]);
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies ghFetch
   * @scenario A rate-limited read whose reset lands beyond the request deadline
   * @expectedOutput The retry is abandoned rather than slept through. The wait and
   *                 the retry share one deadline; letting the retry start a fresh
   *                 timeout means one call can take the wait plus a full timeout,
   *                 which is longer than the lease that stops a second send
   *                 overlapping it.
   */
  it("should not retry when the wait would outlast the deadline", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { message: "rate limited" },
        {
          status: 403,
          headers: {
            "x-ratelimit-remaining": "0",
            // An hour away: far beyond the request deadline.
            "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3_600),
          },
        }
      )
    );

    await expect(
      githubProvider.fetchComments?.("octo", "repo", 7, "token-abc")
    ).rejects.toBeInstanceOf(ProviderApiError);

    // One request only: the retry never ran.
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  /**
   * @target githubProvider.fetchComments
   * @dependencies ghFetch
   * @scenario A rate-limited read retries inside the budget, and the retry then
   *           stalls with no further response
   * @expectedOutput The retry is aborted at the deadline rather than hanging. The
   *                 retry used to inherit the caller's signal after its timer had
   *                 been cleared, so it had no deadline at all — the one path a
   *                 stalled provider could hold open indefinitely.
   */
  it("should give the retry its own deadline", async () => {
    vi.useFakeTimers();
    try {
      // First response: rate limited, resetting a moment from now.
      mockFetch.mockResolvedValueOnce(
        jsonResponse(
          { message: "rate limited" },
          {
            status: 403,
            headers: {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(Math.floor(Date.now() / 1000)),
            },
          }
        )
      );
      // The retry never answers, and only rejects when its signal aborts.
      mockFetch.mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init.signal as AbortSignal;
            if (!signal) {
              // No signal means no deadline: the failure this test exists for.
              return;
            }
            signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
          })
      );

      let settled: "ok" | "rejected" | null = null;
      void githubProvider.fetchComments?.("octo", "repo", 7, "token-abc").then(
        () => {
          settled = "ok";
        },
        () => {
          settled = "rejected";
        }
      );

      // Past the retry wait and past the whole request budget.
      await vi.advanceTimersByTimeAsync(120_000);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(settled).toBe("rejected");
    } finally {
      vi.useRealTimers();
    }
  });

  /**
   * @target githubProvider.getAuthenticatedUser
   * @dependencies ghFetch
   * @scenario The provider answers 401 and the body is never read
   * @expectedOutput No timer is left armed. Callers that return on `!res.ok`
   *                 without touching the body used to leak one 30s timer per
   *                 failed request, because the deadline was only released by the
   *                 body-read helpers. Four call sites did exactly that.
   */
  it("should not leave a timer armed when a failed response is not read", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockResolvedValueOnce(errorResponse(401, "bad credentials"));

      await expect(githubProvider.getAuthenticatedUser?.("token-abc")).resolves.toBeNull();

      // A leaked timer is still queued. Only the ones this test created should
      // remain, and there should be none.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("githubProvider.createComment", () => {
  /**
   * @target githubProvider.createComment
   * @dependencies fetch
   * @scenario The provider accepts the comment
   * @expectedOutput A POST with `{ body }` and the stored comment mapped back
   */
  it("should post the body and map the created comment", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(githubComment({ id: 1002, body: "Thanks!" })));

    const created = await githubProvider.createComment?.("octo", "repo", 7, "token-abc", "Thanks!");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toBe(GITHUB_COMMENTS_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ body: "Thanks!" });
    expect(created).toMatchObject({ id: "1002", body: "Thanks!", author: "nadia" });
    expect(created?.createdAt).toEqual(new Date("2026-02-01T10:00:00Z"));
  });

  /**
   * @target githubProvider.createComment
   * @dependencies ProviderApiError
   * @scenario GitHub refuses the comment with 422
   * @expectedOutput `ProviderApiError` with that status and `createComment` as
   *                 the operation, which is what lets the send path tell a
   *                 definitive rejection from an ambiguous failure
   */
  it("should throw a provider error when the post is refused", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(422, "body is too long"));

    await expect(
      githubProvider.createComment?.("octo", "repo", 7, "token-abc", "Thanks!")
    ).rejects.toMatchObject({ status: 422, operation: "createComment", provider: "github" });
  });

  /**
   * @target githubProvider.createComment
   * @dependencies ProviderApiError
   * @scenario GitHub answers with a server error, then with a validation rejection
   * @expectedOutput The 500 is retryable and the 422 is not. That distinction is
   *                 how the send path knows an outcome is ambiguous rather than a
   *                 refusal, and only a refusal may release the claim.
   */
  it("should report a 500 as retryable and a 422 as definitive", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, "boom"));
    const serverError = await githubProvider
      .createComment?.("octo", "repo", 7, "token-abc", "Thanks!")
      .catch((error: unknown) => error);

    mockFetch.mockResolvedValueOnce(errorResponse(422, "invalid"));
    const clientError = await githubProvider
      .createComment?.("octo", "repo", 7, "token-abc", "Thanks!")
      .catch((error: unknown) => error);

    expect((serverError as ProviderApiError).isRetryable).toBe(true);
    expect((clientError as ProviderApiError).isRetryable).toBe(false);
  });

  /**
   * @target githubProvider.createComment
   * @dependencies fetch
   * @scenario The comment POST is answered by a rate-limited 403
   * @expectedOutput Exactly one POST. The retry in `ghFetch` waits for the reset
   *                 window and re-sends, which is right for a read and wrong for a
   *                 publish: a comment has no idempotency key, so the replay posts
   *                 the same reply twice. A publish must surface the refusal.
   */
  it("should not retry a rate-limited comment POST", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(
        { message: "API rate limit exceeded" },
        { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "0" } }
      )
    );

    await expect(
      githubProvider.createComment?.("octo", "repo", 7, "token-abc", "Thanks!")
    ).rejects.toBeInstanceOf(ProviderApiError);

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

});

describe("gitlabProvider.fetchComments", () => {
  /**
   * @target gitlabProvider.fetchComments
   * @dependencies fetch
   * @scenario GitLab returns a page of notes
   * @expectedOutput The request asks for comments only, newest first, and the
   *                 page is reversed so the caller reads oldest first
   */
  it("should request comments newest-first and reverse them", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        gitlabNote({ id: 3, body: "Third", created_at: "2026-02-03T00:00:00Z" }),
        gitlabNote({ id: 2, body: "Second", created_at: "2026-02-02T00:00:00Z" }),
        gitlabNote({ id: 1, body: "First", created_at: "2026-02-01T00:00:00Z" }),
      ])
    );

    const page = await gitlabProvider.fetchComments?.("octo", "repo", 7, "token-abc");

    const [url] = mockFetch.mock.calls[0];
    const query = new URL(String(url)).searchParams;
    expect(query.get("sort")).toBe("desc");
    expect(query.get("order_by")).toBe("created_at");
    expect(query.get("activity_filter")).toBe("only_comments");
    expect(page?.comments.map((comment) => comment.body)).toEqual(["First", "Second", "Third"]);
  });

  /**
   * @target gitlabProvider.fetchComments
   * @dependencies fetch
   * @scenario The server returns a system note despite the request asking for
   *           comments only
   * @expectedOutput It is filtered out: a label change is not a reply, and the
   *                 request filter alone is not something to rely on
   */
  it("should filter a system note even when the server returns one", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        gitlabNote({ id: 3, body: "Still seeing this", created_at: "2026-02-03T00:00:00Z" }),
        gitlabNote({
          id: 2,
          body: "added label bug",
          system: true,
          author: { username: "gitlab-bot", avatar_url: null },
          created_at: "2026-02-02T00:00:00Z",
        }),
      ])
    );

    const page = await gitlabProvider.fetchComments?.("octo", "repo", 7, "token-abc");

    expect(page?.comments).toHaveLength(1);
    expect(page?.comments[0].body).toBe("Still seeing this");
  });

  /**
   * @target gitlabProvider.fetchComments
   * @dependencies fetch
   * @scenario GitLab advertises a following page through `x-next-page`
   * @expectedOutput A cursor for that page, so the caller can walk towards older
   *                 notes with the provider's own paging direction hidden
   */
  it("should build the older cursor from x-next-page", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([gitlabNote()], { headers: { "x-next-page": "2" } })
    );

    const page = await gitlabProvider.fetchComments?.("octo", "repo", 7, "token-abc");

    expect(page?.olderCursor).toBe("2");
  });

  /**
   * @target gitlabProvider.fetchComments
   * @dependencies fetch
   * @scenario `x-next-page` is absent, which is how GitLab says "no more pages"
   * @expectedOutput `olderCursor: null`
   */
  it("should report no older cursor when x-next-page is absent", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([gitlabNote()]));

    const page = await gitlabProvider.fetchComments?.("octo", "repo", 7, "token-abc");

    expect(page?.olderCursor).toBeNull();
  });

  /**
   * @target gitlabProvider.fetchComments
   * @dependencies fetch
   * @scenario The cursor is not a positive integer
   * @expectedOutput `ProviderApiError` without a request
   */
  it("should throw for an invalid cursor without calling the provider", async () => {
    await expect(
      gitlabProvider.fetchComments?.("octo", "repo", 7, "token-abc", { cursor: "-2" })
    ).rejects.toBeInstanceOf(ProviderApiError);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  /**
   * @target gitlabProvider.fetchComments
   * @dependencies ProviderApiError
   * @scenario GitLab answers 500
   * @expectedOutput `ProviderApiError` with the status and operation recorded
   */
  it("should throw a provider error on a non-2xx response", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(500, "boom"));

    await expect(
      gitlabProvider.fetchComments?.("octo", "repo", 7, "token-abc")
    ).rejects.toMatchObject({ status: 500, operation: "fetchComments", provider: "gitlab" });
  });
});

describe("gitlabProvider.createComment", () => {
  /**
   * @target gitlabProvider.createComment
   * @dependencies fetch
   * @scenario GitLab accepts the note
   * @expectedOutput A POST to the notes endpoint with `{ body }`, mapped back
   */
  it("should post the body and map the created note", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse(gitlabNote({ id: 2003, body: "Thanks!" })));

    const created = await gitlabProvider.createComment?.("octo", "repo", 7, "token-abc", "Thanks!");

    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toBe(GITLAB_NOTES_URL);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ body: "Thanks!" });
    expect(created).toMatchObject({ id: "2003", body: "Thanks!", author: "nadia" });
    expect(created?.url).toBeNull();
  });

  /**
   * @target gitlabProvider.createComment
   * @dependencies ProviderApiError
   * @scenario GitLab refuses the note
   * @expectedOutput `ProviderApiError` with `createComment` as the operation
   */
  it("should throw a provider error when the note is refused", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(400, "body is invalid"));

    await expect(
      gitlabProvider.createComment?.("octo", "repo", 7, "token-abc", "Thanks!")
    ).rejects.toMatchObject({ status: 400, operation: "createComment", provider: "gitlab" });
  });

  /**
   * @target gitlabProvider.createComment
   * @dependencies fetch
   * @scenario The provider sends headers promptly and then stalls the body
   * @expectedOutput The call still settles. Clearing the timer when the headers
   *                 arrived left the body read with no deadline, so a stalled
   *                 response could outlast the send-claim lease and let a second
   *                 publish overlap the first.
   */
  it("should keep the deadline while the body is being read", async () => {
    vi.useFakeTimers();
    try {
      // Models the platform: a real fetch rejects a pending body read when its
      // signal aborts. The mock does the same, so this measures whether the
      // client still holds the signal open at the point the body is read.
      mockFetch.mockImplementationOnce(async (_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal;
        return {
          ok: true,
          status: 201,
          json: () =>
            new Promise((_resolve, reject) => {
              if (signal.aborted) return reject(new Error("aborted"));
              signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
            }),
        } as unknown as Response;
      });

      let settled: "resolved" | "rejected" | null = null;
      void gitlabProvider
        .createComment?.("octo", "repo", 7, "token-abc", "Thanks!")
        .then(
          () => {
            settled = "resolved";
          },
          () => {
            settled = "rejected";
          }
        );

      // Let the request reach the body read, then run past the deadline.
      await vi.advanceTimersByTimeAsync(31_000);

      // A cleared timer means nothing aborts the pending body read, so it never
      // settles — and the publish outlives the lease meant to block a second one.
      expect(settled).toBe("rejected");
    } finally {
      vi.useRealTimers();
    }
  });

});

describe("gitlabProvider.getAuthenticatedUser", () => {
  /**
   * @target gitlabProvider.getAuthenticatedUser
   * @dependencies fetch
   * @scenario The token can read its own user
   * @expectedOutput The username mapped to `login`, with its avatar
   */
  it("should map the GitLab username to a login", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ username: "me", avatar_url: "https://gitlab.test/me.png" })
    );

    const identity = await gitlabProvider.getAuthenticatedUser?.("token-abc");

    expect(String(mockFetch.mock.calls[0][0])).toBe("https://gitlab.com/api/v4/user");
    expect(identity).toEqual({ login: "me", avatar: "https://gitlab.test/me.png" });
  });

  /**
   * @target gitlabProvider.getAuthenticatedUser
   * @dependencies fetch
   * @scenario The response carries no username
   * @expectedOutput `null`, so the follow-up check knows it cannot tell the
   *                 user's own comments apart rather than comparing against ""
   */
  it("should return null when the response has no username", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ id: 1 }));

    expect(await gitlabProvider.getAuthenticatedUser?.("token-abc")).toBeNull();
  });

  /**
   * @target gitlabProvider.getAuthenticatedUser
   * @dependencies fetch
   * @scenario The token cannot read `/user`
   * @expectedOutput `null` rather than a throw
   */
  it("should return null on a failed request", async () => {
    mockFetch.mockResolvedValueOnce(errorResponse(401, "bad credentials"));

    expect(await gitlabProvider.getAuthenticatedUser?.("token-abc")).toBeNull();
  });
});

describe("isSystem mapping", () => {
  /**
   * @target toProviderComment
   * @dependencies fetch
   * @scenario GitHub returns a comment
   * @expectedOutput `isSystem: false` regardless of the payload: GitHub keeps
   *                 generated activity out of the comment stream, so anything
   *                 there was typed by a person
   */
  it("should always mark a GitHub comment as a human comment", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([githubComment({ body: "added label bug" })]));

    const page = await githubProvider.fetchComments?.("octo", "repo", 7, "token-abc");

    expect(page?.comments[0].isSystem).toBe(false);
  });

  /**
   * @target toProviderComment
   * @dependencies fetch
   * @scenario GitLab returns one human note, alongside a generated one that the
   *           adapter drops
   * @expectedOutput The surviving note is not a system record, which is what
   *                 keeps a label change out of the follow-up check
   */
  it("should map a GitLab note's system flag", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse([
        gitlabNote({ id: 2, body: "human", system: false }),
        gitlabNote({ id: 1, body: "changed the description", system: true }),
      ])
    );

    const page = await gitlabProvider.fetchComments?.("octo", "repo", 7, "token-abc");

    expect(page?.comments).toHaveLength(1);
    expect(page?.comments[0].body).toBe("human");
    expect(page?.comments[0].isSystem).toBe(false);
  });
});
