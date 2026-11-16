/**
 * @module presets/use-presets
 *
 * TanStack Query hooks for the personal preset list and its writes.
 *
 * The list is repository-scoped: a preset stores provider values, so a bundle
 * written against one repository's labels is meaningless in another. Every
 * write invalidates exactly that repository's key, which is why the mutations
 * take the `repoId` the caller already has from the open issue.
 *
 * Failures surface the server's own sentence. The preset routes reject a write
 * for specific reasons — the quota, a provider limit, a permission — and those
 * sentences are the only thing that tells a user what to change.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { readApiError } from "./api-error";
import type { Preset, PresetActions } from "./types";
import { devPresets, readDataMode } from "@/features/dev-tools/data-mode";

/** Body of `POST /api/presets`, minus the repository the hook already holds. */
export interface CreatePresetInput {
  name: string;
  actions: PresetActions;
}

/** Body of `PATCH /api/presets/:id`. */
export interface UpdatePresetInput {
  id: string;
  name?: string;
  actions?: PresetActions;
}

/** Body of `DELETE /api/presets/:id`. */
export interface DeletePresetInput {
  id: string;
}

/**
 * Lists the presets stored for one repository.
 *
 * @param repoId - The issue's repository, or `undefined` when no issue is selected.
 * @returns A TanStack `UseQueryResult<Preset[]>`; disabled until a repo exists.
 */
export function usePresets(repoId: string | undefined) {
  return useQuery<Preset[]>({
    queryKey: ["presets", repoId],
    queryFn: async () => {
      if (!repoId) return [];
      // The dev-only data toggle swaps the real presets for the worst case.
      const fixture = await devPresets(readDataMode());
      if (fixture) return fixture;
      const res = await fetch(`/api/presets?repoId=${encodeURIComponent(repoId)}`);
      if (!res.ok) throw new Error(await readApiError(res, "Failed to fetch presets"));
      return res.json();
    },
    enabled: !!repoId,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}

/**
 * Creates a preset in the repository the hook was opened for.
 *
 * @param repoId - The repository the new preset belongs to.
 * @returns A TanStack mutation; `mutate` accepts a {@link CreatePresetInput}.
 */
export function useCreatePreset(repoId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<Preset, Error, CreatePresetInput>({
    mutationFn: async ({ name, actions }) => {
      if (!repoId) throw new Error("Choose a repository before saving a preset");
      const res = await fetch("/api/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoId, name, actions }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to save preset"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presets", repoId] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

/**
 * Renames a preset, or replaces its actions.
 *
 * @param repoId - The repository whose list is invalidated.
 * @returns A TanStack mutation; `mutate` accepts an {@link UpdatePresetInput}.
 */
export function useUpdatePreset(repoId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<Preset, Error, UpdatePresetInput>({
    mutationFn: async ({ id, name, actions }) => {
      const res = await fetch(`/api/presets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, actions }),
      });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to update preset"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presets", repoId] });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

/**
 * Deletes a preset. Issues it was applied to keep their labels, assignees, and
 * priority: deleting the recipe does not eat the cake.
 *
 * @param repoId - The repository whose list is invalidated.
 * @returns A TanStack mutation; `mutate` accepts a {@link DeletePresetInput}.
 */
export function useDeletePreset(repoId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation<{ ok: true }, Error, DeletePresetInput>({
    mutationFn: async ({ id }) => {
      const res = await fetch(`/api/presets/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to delete preset"));
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["presets", repoId] });
      toast.success("Preset deleted");
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
}

/** The connected repo fields the picker's wording needs. */
interface CachedRepo {
  id: string;
  syncMode?: string;
}

/**
 * Reads the issue's repository sync mode out of the shared repo cache.
 *
 * The app shell and the repo manager already load `GET /api/repos`, and that
 * response carries `syncMode`, so the picker needs neither a second fetch nor a
 * prop threaded down from the inbox for a button label. The query is disabled
 * rather than duplicated: it subscribes to the cached list and updates when the
 * shell's fetch lands, without ever issuing a request of its own. The value is
 * advisory — the server decides the effective mode and returns it — and
 * `undefined` means "not cached yet", which falls back to that same decision
 * instead of assuming live.
 *
 * @param repoId - The issue's repository.
 * @returns `true` for batch, `false` for live, or `undefined` when not cached.
 */
export function useRepoBatchMode(repoId: string | undefined): boolean | undefined {
  const { data: repos } = useQuery<CachedRepo[]>({
    queryKey: ["connected-repos"],
    enabled: false,
    staleTime: 60_000,
  });

  if (!repoId) return undefined;
  const repo = repos?.find((item) => item.id === repoId);
  if (!repo) return undefined;
  return repo.syncMode === "batch";
}
