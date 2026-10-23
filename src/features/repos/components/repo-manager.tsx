/**
 * @module repos/components/repo-manager
 *
 * Repository management page component. Shows two panels:
 * 1. **Connected Repositories** — list of tracked repos with disconnect buttons
 * 2. **Add Repository** — tabbed browser (GitHub/GitLab) to discover and connect new repos
 */
"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import { GitHubIcon } from "@/components/icons/github-icon";
import { devAvailableRepos, devRepos, readDataMode } from "@/features/dev-tools/data-mode";
import type { AvailableRepo } from "../fetch-available-repos";

/** Shape of a connected repo record from the repos API. */
interface ConnectedRepo {
  id: string;
  provider: string;
  owner: string;
  name: string;
  fullName: string;
  permission: string;
  syncEnabled: boolean;
}

/**
 * Full repo management UI with connected list and provider-tabbed browser.
 * Handles connect/disconnect operations with optimistic UI updates.
 */
export function RepoManager() {
  const queryClient = useQueryClient();
  const [activeProvider, setActiveProvider] = useState<"github" | "gitlab">("github");
  const [connectingRepo, setConnectingRepo] = useState<string | null>(null);

  // The sidebar reads the same query, so both stay in step after a change.
  const { data: connected = [], isLoading: loadingConnected } = useQuery<ConnectedRepo[]>({
    queryKey: ["connected-repos"],
    queryFn: async () => {
      // The dev-only data toggle swaps the real repos for the worst case.
      const fixture = await devRepos(readDataMode());
      if (fixture) return fixture;
      return fetch("/api/repos").then((res) => (res.ok ? res.json() : []));
    },
    staleTime: 60_000,
  });

  const { data: available = [], isFetching: loadingAvailable } = useQuery<AvailableRepo[]>({
    queryKey: ["available-repos", activeProvider],
    queryFn: async () => {
      const fixture = await devAvailableRepos(readDataMode());
      if (fixture) return fixture;
      return fetch(`/api/repos/available?provider=${activeProvider}`).then((res) =>
        res.ok ? res.json() : []
      );
    },
    staleTime: 60_000,
  });

  function handleTabChange(value: string) {
    setActiveProvider(value as "github" | "gitlab");
  }

  async function handleConnect(repo: AvailableRepo) {
    setConnectingRepo(repo.fullName);
    const res = await fetch("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: repo.provider, owner: repo.owner, name: repo.name }),
    });
    if (res.ok) {
      await queryClient.invalidateQueries({ queryKey: ["connected-repos"] });
      await queryClient.invalidateQueries({ queryKey: ["available-repos"] });
    }
    setConnectingRepo(null);
  }

  async function handleDisconnect(id: string) {
    await fetch(`/api/repos/${id}`, { method: "DELETE" });
    await queryClient.invalidateQueries({ queryKey: ["connected-repos"] });
  }

  const connectedFullNames = new Set(connected.map((r) => r.fullName));

  return (
    <div className="space-y-8">
      {/* Connected repos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Connected repositories</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingConnected ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : connected.length === 0 ? (
            <EmptyState
              icon={<Plug className="h-5 w-5" />}
              title="No repositories connected"
              description="Connect one below and its issues land in your inbox."
              className="py-10"
            />
          ) : (
            <div className="divide-y border-y">
              {connected.map((repo) => (
                <div key={repo.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <ProviderIcon provider={repo.provider} />
                    <span className="truncate text-sm font-medium" title={repo.fullName}>
                      {repo.fullName}
                    </span>
                    <PermissionBadge permission={repo.permission} />
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Disconnect ${repo.fullName}`}
                        className="shrink-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect {repo.fullName}?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This removes the cached issues and triage state for this repository. You
                          can reconnect it later, but the triage data is gone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleDisconnect(repo.id)}>
                          Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Browse available repos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Add a repository</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="github" onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="github">
                <GitHubIcon className="h-3.5 w-3.5" />
                GitHub
              </TabsTrigger>
              <TabsTrigger value="gitlab">
                <GitLabIcon className="h-3.5 w-3.5" />
                GitLab
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeProvider} className="mt-4">
              {loadingAvailable && (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Loading repositories...
                  </span>
                </div>
              )}

              {!loadingAvailable && available.length === 0 && (
                <EmptyState
                  icon={<Plug className="h-5 w-5" />}
                  title="No repositories to show"
                  description={`Your ${activeProvider} account has no repositories SnapTriage can read.`}
                  className="py-10"
                />
              )}

              {!loadingAvailable && available.length > 0 && (
                <div className="max-h-96 divide-y overflow-y-auto border-y">
                  {available.map((repo) => {
                    const isConnected = connectedFullNames.has(repo.fullName);
                    return (
                      <div
                        key={repo.fullName}
                        className="flex items-center justify-between gap-3 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium" title={repo.fullName}>
                            {repo.fullName}
                          </p>
                          {repo.description && (
                            <p
                              className="truncate text-xs text-muted-foreground"
                              title={repo.description}
                            >
                              {repo.description}
                            </p>
                          )}
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <PermissionBadge permission={repo.permission} />
                            {repo.isPrivate && <PrivateBadge />}
                          </div>
                        </div>
                        <Button
                          variant={isConnected ? "secondary" : "outline"}
                          size="sm"
                          disabled={isConnected || connectingRepo === repo.fullName}
                          onClick={() => handleConnect(repo)}
                          className="h-8 shrink-0 gap-1.5 px-2.5 text-xs"
                        >
                          {connectingRepo === repo.fullName ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : isConnected ? (
                            "Connected"
                          ) : (
                            <>
                              <Plus className="h-3.5 w-3.5" />
                              Add
                            </>
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

/** Chip showing repo permission level (admin/write/read). */
function PermissionBadge({ permission }: { permission: string }) {
  return (
    <span className="shrink-0 rounded border px-1.5 py-px font-mono text-[10px] leading-4 text-muted-foreground">
      {permission}
    </span>
  );
}

/** Chip marking a repository as private. */
function PrivateBadge() {
  return (
    <span className="shrink-0 rounded border px-1.5 py-px font-mono text-[10px] leading-4 text-muted-foreground">
      private
    </span>
  );
}

/** Renders the GitHub or GitLab icon based on provider name. */
function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "github") {
    return <GitHubIcon className="h-4 w-4 shrink-0" />;
  }
  return <GitLabIcon className="h-4 w-4 shrink-0" />;
}
