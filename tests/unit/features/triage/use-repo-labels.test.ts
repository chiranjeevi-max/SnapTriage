import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRepoLabels } from "@/features/triage/use-repo-labels";
import { useQuery } from "@tanstack/react-query";

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
}));

describe("useRepoLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls useQuery with correct configuration when repoId is provided", () => {
    useRepoLabels("repo-123");

    expect(useQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ["repo-labels", "repo-123"],
      enabled: true,
      staleTime: 600000,
    }));
  });

  it("calls useQuery with disabled configuration when repoId is undefined", () => {
    useRepoLabels(undefined);

    expect(useQuery).toHaveBeenCalledWith(expect.objectContaining({
      queryKey: ["repo-labels", undefined],
      enabled: false,
    }));
  });

  it("returns an empty array when repoId is missing inside queryFn", async () => {
    let capturedQueryFn: any;
    vi.mocked(useQuery).mockImplementation((options: any) => {
      capturedQueryFn = options.queryFn;
      return {} as any;
    });

    useRepoLabels(undefined);
    const result = await capturedQueryFn();
    expect(result).toEqual([]);
  });

  it("fetches labels when repoId is provided inside queryFn", async () => {
    const mockLabels = [{ id: "label-1", name: "bug", color: "ff0000" }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(mockLabels),
    });

    let capturedQueryFn: any;
    vi.mocked(useQuery).mockImplementation((options: any) => {
      capturedQueryFn = options.queryFn;
      return {} as any;
    });

    useRepoLabels("repo-123");
    const result = await capturedQueryFn();

    expect(global.fetch).toHaveBeenCalledWith("/api/repos/repo-123/labels");
    expect(result).toEqual(mockLabels);
  });

  it("throws an error when fetch fails", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
    });

    let capturedQueryFn: any;
    vi.mocked(useQuery).mockImplementation((options: any) => {
      capturedQueryFn = options.queryFn;
      return {} as any;
    });

    useRepoLabels("repo-123");

    await expect(capturedQueryFn()).rejects.toThrow("Failed to fetch labels");
  });
});
