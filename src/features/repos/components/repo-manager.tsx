/**
 * @module repos/components/repo-manager
 *
 * Repository management page component. Shows two cards:
 * 1. **Connected Repositories** — list of tracked repos with disconnect buttons
 * 2. **Add Repository** — tabbed browser (GitHub/GitLab) to discover and connect new repos
 */
"use client";

import { useEffect, useState } from "react";
import { Github, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
  const [connected, setConnected] = useState<ConnectedRepo[]>([]);
  const [available, setAvailable] = useState<AvailableRepo[]>([]);
  const [loadingConnected, setLoadingConnected] = useState(true);
  const [loadingAvailable, setLoadingAvailable] = useState(false);
  const [activeProvider, setActiveProvider] = useState<"github" | "gitlab">("github");
  const [connectingRepo, setConnectingRepo] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/repos")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) {
          setConnected(data);
          setLoadingConnected(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function fetchAvailable(provider: "github" | "gitlab") {
    setLoadingAvailable(true);
    setAvailable([]);
    const res = await fetch(`/api/repos/available?provider=${provider}`);
    if (res.ok) {
      setAvailable(await res.json());
    }
    setLoadingAvailable(false);
  }

  function handleTabChange(value: string) {
    const provider = value as "github" | "gitlab";
    setActiveProvider(provider);
    fetchAvailable(provider);
  }

  async function handleConnect(repo: AvailableRepo) {
    setConnectingRepo(repo.fullName);
    const res = await fetch("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(repo),
    });
    if (res.ok) {
      const refreshed = await fetch("/api/repos");
      if (refreshed.ok) setConnected(await refreshed.json());
    }
    setConnectingRepo(null);
  }

  async function handleDisconnect(id: string) {
    await fetch(`/api/repos/${id}`, { method: "DELETE" });
    setConnected((prev) => prev.filter((r) => r.id !== id));
  }

  const connectedFullNames = new Set(connected.map((r) => r.fullName));

  return (
    <div className="space-y-6">
      {/* Connected repos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Connected Repositories</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingConnected ? (
            <div className="space-y-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : connected.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repositories connected yet. Browse below to add one.
            </p>
          ) : (
            <div className="space-y-2">
              {connected.map((repo) => (
                <div
                  key={repo.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    <ProviderIcon provider={repo.provider} />
                    <div>
                      <p className="text-sm font-medium">{repo.fullName}</p>
                      <PermissionBadge permission={repo.permission} />
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDisconnect(repo.id)}>
                    <Trash2 className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Browse available repos */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Add Repository</CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="github" onValueChange={handleTabChange}>
            <TabsList>
              <TabsTrigger value="github">
                <Github className="mr-1.5 h-4 w-4" />
                GitHub
              </TabsTrigger>
              <TabsTrigger value="gitlab">
                <GitLabIcon className="mr-1.5 h-4 w-4" />
                GitLab
              </TabsTrigger>
            </TabsList>

            <TabsContent value={activeProvider} className="mt-4">
              {!loadingAvailable && available.length === 0 && !loadingConnected && (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">
                    Click a tab above to load your {activeProvider} repositories.
                  </p>
                </div>
              )}

              {loadingAvailable && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">
                    Loading repositories...
                  </span>
                </div>
              )}

              {!loadingAvailable && available.length > 0 && (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {available.map((repo) => {
                    const isConnected = connectedFullNames.has(repo.fullName);
                    return (
                      <div
                        key={repo.fullName}
                        className="flex items-center justify-between rounded-lg border p-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{repo.fullName}</p>
                          {repo.description && (
                            <p className="text-xs text-muted-foreground truncate">
                              {repo.description}
                            </p>
                          )}
                          <div className="mt-1 flex items-center gap-2">
                            <PermissionBadge permission={repo.permission} />
                            {repo.isPrivate && (
                              <Badge variant="outline" className="text-xs">
                                Private
                              </Badge>
                            )}
                          </div>
                        </div>
                        <Button
                          variant={isConnected ? "secondary" : "outline"}
                          size="sm"
                          disabled={isConnected || connectingRepo === repo.fullName}
                          onClick={() => handleConnect(repo)}
                          className="ml-3 shrink-0"
                        >
                          {connectingRepo === repo.fullName ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : isConnected ? (
                            "Connected"
                          ) : (
                            <>
                              <Plus className="mr-1 h-4 w-4" />
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

/** Color-coded badge showing repo permission level (admin/write/read). */
function PermissionBadge({ permission }: { permission: string }) {
  const variant =
    permission === "admin" ? "default" : permission === "write" ? "secondary" : "outline";
  return (
    <Badge variant={variant} className="text-xs">
      {permission}
    </Badge>
  );
}

/** Renders the GitHub or GitLab icon based on provider name. */
function ProviderIcon({ provider }: { provider: string }) {
  if (provider === "github") return <Github className="h-4 w-4 shrink-0" />;
  return <GitLabIcon className="h-4 w-4 shrink-0" />;
}

/** Inline GitLab logo SVG. */
function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}
