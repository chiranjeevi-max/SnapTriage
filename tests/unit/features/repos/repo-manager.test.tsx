/**
 * @module tests/unit/features/repos/repo-manager
 *
 * A failed refetch must keep the cached rows and still offer a retry.
 */
/* @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RepoManager } from "@/features/repos/components/repo-manager";

const { refetchConnected } = vi.hoisted(() => ({ refetchConnected: vi.fn() }));

vi.mock("@/features/repos/use-connected-repos", () => ({
  CONNECTED_REPOS_KEY: ["connected-repos"],
  useConnectedRepos: () => ({
    data: [
      {
        id: "r1",
        provider: "github",
        owner: "acme",
        name: "console",
        fullName: "acme/console",
        permission: "admin",
        syncMode: "live",
        syncEnabled: true,
      },
    ],
    isLoading: false,
    isError: true,
    refetch: refetchConnected,
  }),
}));

vi.mock("@/features/dev-tools/data-mode", () => ({
  devAvailableRepos: async () => [],
  readDataMode: () => "empty",
}));

describe("RepoManager", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    vi.clearAllMocks();
  });

  it("keeps cached rows and shows a retry when the refetch fails", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <RepoManager />
      </QueryClientProvider>
    );

    await waitFor(() =>
      expect(
        screen.getByText(
          "Could not refresh the repository list. Showing the last known repositories."
        )
      ).toBeDefined()
    );
    expect(screen.getByText("acme/console")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetchConnected).toHaveBeenCalledTimes(1);
  });
});
