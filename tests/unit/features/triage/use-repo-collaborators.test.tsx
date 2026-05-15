import { describe, it, expect, vi, beforeEach } from "vitest";

/* @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { useRepoCollaborators } from "@/features/triage/use-repo-collaborators";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

describe("useRepoCollaborators", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  it("should be disabled and not fetch when repoId is undefined", async () => {
    const { result } = renderHook(() => useRepoCollaborators(undefined), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("should fetch and return collaborators when repoId is valid", async () => {
    const mockCollaborators = [{ login: "user1" }, { login: "user2" }];
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockCollaborators,
    } as Response);

    const { result } = renderHook(() => useRepoCollaborators("repo-123"), {
      wrapper,
    });

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/repos/repo-123/collaborators");
    expect(result.current.data).toEqual(mockCollaborators);
  });

  it("should throw error on failed fetch", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
    } as Response);

    const { result } = renderHook(() => useRepoCollaborators("repo-123"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.error).toBeDefined();
    expect(result.current.error?.message).toBe("Failed to fetch collaborators");
  });
});
