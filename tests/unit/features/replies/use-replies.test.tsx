// @vitest-environment jsdom
/**
 * @module tests/unit/features/replies/use-replies
 *
 * The client half of the send-failure contract.
 *
 * The server distinguishes a definitive refusal (429, 422, 400) from an
 * ambiguous outcome (5xx, lost response). The composer only withholds Send for
 * the second kind, so the hook has to preserve that distinction rather than
 * flatten every failure into one error. These tests pin the two paths that
 * matter: an exhausted send bucket must not latch the composer, and a 5xx must.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { UnconfirmedSendError, useSendReply } from "@/features/replies/use-replies";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fresh client per test, so a cached draft cannot leak between cases. */
function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

/** A failed response with a JSON body, as the route returns it. */
function failure(status: number, body: unknown) {
  return {
    ok: false,
    status,
    json: async () => body,
  };
}

describe("useSendReply", () => {
  /**
   * @target useSendReply
   * @dependencies readSendFailure
   * @scenario The send bucket is exhausted
   * @expectedOutput A plain `Error`, not `UnconfirmedSendError`. Nothing was
   *                 published, so the composer must keep Send available once the
   *                 window passes instead of asking the user to check the issue.
   */
  it("should surface a 429 as a definitive failure", async () => {
    fetchMock.mockResolvedValue(
      failure(429, { error: "Too many replies in a short time. Wait a moment." })
    );

    const { result } = renderHook(() => useSendReply("issue-1"), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ body: "Thanks" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error).not.toBeInstanceOf(UnconfirmedSendError);
    expect(result.current.error?.message).toContain("Too many replies");
  });

  /**
   * @target useSendReply
   * @dependencies readSendFailure
   * @scenario The provider or a gateway answers 5xx
   * @expectedOutput `UnconfirmedSendError`, which withholds Send and tells the
   *                 user to check the issue. The comment may already be public.
   */
  it("should keep a 5xx unconfirmed", async () => {
    fetchMock.mockResolvedValue(failure(502, { error: "Bad gateway" }));

    const { result } = renderHook(() => useSendReply("issue-1"), {
      wrapper: createWrapper(),
    });

    result.current.mutate({ body: "Thanks" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(UnconfirmedSendError);
  });
});
