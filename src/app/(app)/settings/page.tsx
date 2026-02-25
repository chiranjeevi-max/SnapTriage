/**
 * @module app/(app)/settings/page
 * Settings page for SnapTriage. Provides UI sections for theme selection
 * (light/dark/system), per-repository sync configuration (auto-sync toggle
 * and live vs. batch sync mode), connected OAuth/PAT accounts overview,
 * and a keyboard shortcuts reference card.
 */
"use client";

import { useEffect, useState } from "react";
import { Github, Loader2, Moon, Sun, Monitor } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

interface ConnectedRepo {
  id: string;
  provider: string;
  fullName: string;
  permission: string;
  syncEnabled: boolean;
  syncMode: string;
}

interface ConnectedAccount {
  provider: string;
  providerAccountId: string;
  type: string;
}

/**
 * Settings page component that fetches connected repos and accounts on mount,
 * and allows the user to configure appearance, sync behaviour, and view
 * connected accounts and keyboard shortcuts.
 */
export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [repos, setRepos] = useState<ConnectedRepo[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    Promise.all([
      fetch("/api/repos").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/settings/accounts").then((r) => (r.ok ? r.json() : [])),
    ]).then(([repoData, accountData]) => {
      if (!cancelled) {
        setRepos(repoData);
        setAccounts(accountData);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSyncModeToggle(repoId: string, currentMode: string) {
    const newMode = currentMode === "live" ? "batch" : "live";
    const res = await fetch(`/api/repos/${repoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncMode: newMode }),
    });
    if (res.ok) {
      setRepos((prev) => prev.map((r) => (r.id === repoId ? { ...r, syncMode: newMode } : r)));
      toast(`Sync mode set to ${newMode}`);
    }
  }

  async function handleSyncEnabledToggle(repoId: string, enabled: boolean) {
    const res = await fetch(`/api/repos/${repoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncEnabled: !enabled }),
    });
    if (res.ok) {
      setRepos((prev) => prev.map((r) => (r.id === repoId ? { ...r, syncEnabled: !enabled } : r)));
      toast(`Sync ${!enabled ? "enabled" : "disabled"}`);
    }
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure your SnapTriage experience.</p>
      </div>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Choose your preferred theme.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button
              variant={theme === "light" ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme("light")}
            >
              <Sun className="mr-1.5 h-4 w-4" />
              Light
            </Button>
            <Button
              variant={theme === "dark" ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme("dark")}
            >
              <Moon className="mr-1.5 h-4 w-4" />
              Dark
            </Button>
            <Button
              variant={theme === "system" ? "default" : "outline"}
              size="sm"
              onClick={() => setTheme("system")}
            >
              <Monitor className="mr-1.5 h-4 w-4" />
              System
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sync Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Sync Settings</CardTitle>
          <CardDescription>Configure how each repository syncs with its provider.</CardDescription>
        </CardHeader>
        <CardContent>
          {repos.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No repositories connected. Go to Repos to add one.
            </p>
          ) : (
            <div className="space-y-4">
              {repos.map((repo) => (
                <div key={repo.id} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {repo.provider === "github" ? (
                        <Github className="h-4 w-4 shrink-0" />
                      ) : (
                        <GitLabIcon className="h-4 w-4 shrink-0" />
                      )}
                      <span className="text-sm font-medium">{repo.fullName}</span>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {repo.permission}
                    </Badge>
                  </div>

                  <Separator className="my-3" />

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Auto-sync</p>
                        <p className="text-xs text-muted-foreground">
                          Automatically fetch new issues every 5 minutes
                        </p>
                      </div>
                      <Switch
                        checked={repo.syncEnabled}
                        onCheckedChange={() => handleSyncEnabledToggle(repo.id, repo.syncEnabled)}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium">Sync mode</p>
                        <p className="text-xs text-muted-foreground">
                          {repo.syncMode === "live"
                            ? "Changes push to provider immediately"
                            : "Changes are staged until you push"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSyncModeToggle(repo.id, repo.syncMode)}
                      >
                        {repo.syncMode === "live" ? "Live" : "Batch"}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Connected Accounts */}
      <Card>
        <CardHeader>
          <CardTitle>Connected Accounts</CardTitle>
          <CardDescription>OAuth and personal access token connections.</CardDescription>
        </CardHeader>
        <CardContent>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No connected accounts found.</p>
          ) : (
            <div className="space-y-2">
              {accounts.map((account) => (
                <div
                  key={`${account.provider}-${account.providerAccountId}`}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-2">
                    {account.provider === "github" ? (
                      <Github className="h-4 w-4" />
                    ) : (
                      <GitLabIcon className="h-4 w-4" />
                    )}
                    <span className="text-sm font-medium capitalize">{account.provider}</span>
                  </div>
                  <Badge variant="secondary" className="text-xs">
                    {account.type === "oauth" ? "OAuth" : "PAT"}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Keyboard Shortcuts Info */}
      <Card>
        <CardHeader>
          <CardTitle>Keyboard Shortcuts</CardTitle>
          <CardDescription>
            Press <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">?</kbd>{" "}
            anywhere in the inbox to view all shortcuts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <ShortcutRow keys="J / K" desc="Navigate issues" />
            <ShortcutRow keys="1-4" desc="Set priority" />
            <ShortcutRow keys="D" desc="Dismiss / undismiss" />
            <ShortcutRow keys="L" desc="Edit labels" />
            <ShortcutRow keys="A" desc="Edit assignees" />
            <ShortcutRow keys="S" desc="Snooze" />
            <ShortcutRow keys="Z" desc="Undo" />
            <ShortcutRow keys="R" desc="Sync issues" />
            <ShortcutRow keys="Shift+P" desc="Push batch changes" />
            <ShortcutRow keys="?" desc="Show all shortcuts" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ShortcutRow({ keys, desc }: { keys: string; desc: string }) {
  return (
    <div className="flex items-center justify-between rounded-md px-2 py-1.5">
      <span className="text-muted-foreground">{desc}</span>
      <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-mono">{keys}</kbd>
    </div>
  );
}

function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}
