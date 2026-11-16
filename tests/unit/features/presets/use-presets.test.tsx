/**
 * @module tests/unit/features/presets/use-presets
 *
 * The preset data hooks. What matters here is that every write invalidates the
 * one repository's list, and that a rejection reaches the toast with the
 * server's own sentence rather than a generic replacement.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import {
  useCreatePreset,
  useDeletePreset,
  usePresets,
  useUpdatePreset,
} from "@/features/presets/use-presets";
import type { Preset } from "@/features/presets/types";

const { toastError, toastSuccess } = vi.hoisted(() => ({
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: toastError, success: toastSuccess }),
}));

/** One stored preset, as `GET /api/presets` returns it. */
const PRESET: Preset = {
  id: "preset-1",
  repoId: "repo-1",
  name: "Confirmed bug",
  actions: { priority: 1, labels: { add: ["bug"] } },
  createdAt: "2026-11-15T00:00:00.000Z",
  updatedAt: "2026-11-15T00:00:00.000Z",
};

describe("preset hooks", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    global.fetch = vi.fn();
    vi.clearAllMocks();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  describe("usePresets", () => {
    it("does not fetch before a repository is selected", () => {
      const { result } = renderHook(() => usePresets(undefined), { wrapper });

      expect(result.current.fetchStatus).toBe("idle");
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("fetches the presets scoped to the repository", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => [PRESET],
      } as Response);

      const { result } = renderHook(() => usePresets("repo-1"), { wrapper });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(global.fetch).toHaveBeenCalledWith("/api/presets?repoId=repo-1");
      expect(result.current.data).toEqual([PRESET]);
    });

    it("surfaces the server message when the list cannot be read", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Repository not found" }),
      } as Response);

      const { result } = renderHook(() => usePresets("repo-1"), { wrapper });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error?.message).toBe("Repository not found");
    });
  });

  describe("useCreatePreset", () => {
    it("posts the name and actions with the repository, then invalidates the list", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => PRESET,
      } as Response);

      const { result } = renderHook(() => useCreatePreset("repo-1"), { wrapper });
      result.current.mutate({ name: "Confirmed bug", actions: { priority: 1 } });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(global.fetch).toHaveBeenCalledWith("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoId: "repo-1",
          name: "Confirmed bug",
          actions: { priority: 1 },
        }),
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["presets", "repo-1"] });
    });

    it("toasts the server's rejection verbatim and does not invalidate", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "A preset needs at least one action" }),
      } as Response);

      const { result } = renderHook(() => useCreatePreset("repo-1"), { wrapper });
      result.current.mutate({ name: "Empty", actions: {} });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(toastError).toHaveBeenCalledWith("A preset needs at least one action");
      expect(invalidate).not.toHaveBeenCalled();
    });
  });

  describe("useUpdatePreset", () => {
    it("patches the preset and invalidates the list", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...PRESET, name: "Renamed" }),
      } as Response);

      const { result } = renderHook(() => useUpdatePreset("repo-1"), { wrapper });
      result.current.mutate({ id: "preset-1", name: "Renamed" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(global.fetch).toHaveBeenCalledWith("/api/presets/preset-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Renamed", actions: undefined }),
      });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["presets", "repo-1"] });
    });

    it("toasts the server's rejection verbatim", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Preset limit reached for this repository" }),
      } as Response);

      const { result } = renderHook(() => useUpdatePreset("repo-1"), { wrapper });
      result.current.mutate({ id: "preset-1", name: "Another" });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(toastError).toHaveBeenCalledWith("Preset limit reached for this repository");
    });
  });

  describe("useDeletePreset", () => {
    it("deletes the preset and invalidates the list", async () => {
      const invalidate = vi.spyOn(queryClient, "invalidateQueries");
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ok: true }),
      } as Response);

      const { result } = renderHook(() => useDeletePreset("repo-1"), { wrapper });
      result.current.mutate({ id: "preset-1" });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(global.fetch).toHaveBeenCalledWith("/api/presets/preset-1", { method: "DELETE" });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["presets", "repo-1"] });
    });

    it("toasts the server's rejection verbatim", async () => {
      vi.mocked(global.fetch).mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: "Preset not found" }),
      } as Response);

      const { result } = renderHook(() => useDeletePreset("repo-1"), { wrapper });
      result.current.mutate({ id: "preset-1" });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(toastError).toHaveBeenCalledWith("Preset not found");
    });
  });
});
