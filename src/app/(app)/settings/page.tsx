/**
 * @module app/(app)/settings/page
 * Settings page for SnapTriage. Provides UI sections for theme selection
 * (light/dark/system), per-repository sync configuration (auto-sync toggle
 * and live vs. batch sync mode), connected OAuth/PAT accounts overview,
 * and a keyboard shortcuts reference.
 */
"use client";

import { useEffect, useState } from "react";
import { Loader2, Moon, Sun, Monitor, Zap, Layers } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { SegmentedControl } from "@/components/segmented-control";
import { Switch } from "@/components/ui/switch";
import { GitHubIcon } from "@/components/icons/github-icon";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import { ShortcutList } from "@/features/keyboard/components/shortcut-list";
import { devAccounts, devRepos, useDataMode } from "@/features/dev-tools/data-mode";

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
  const mode = useDataMode();
  const [repos, setRepos] = useState<ConnectedRepo[]>([]);
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    // The dev-only data toggle swaps the real data for the worst case.
    Promise.all([devRepos(mode), devAccounts(mode)]).then(async ([repoFixture, accountFixture]) => {
      const [repos, accounts] = await Promise.all([
        repoFixture ?? fetch("/api/repos").then((r) => (r.ok ? r.json() : [])),
        accountFixture ?? fetch("/api/settings/accounts").then((r) => (r.ok ? r.json() : [])),
      ]);
      if (!cancelled) {
        setRepos(repos);
        setAccounts(accounts);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [mode]);

  async function handleSyncModeToggle(repoId: string, currentMode: string) {
    const newMode = currentMode === "live" ? "batch" : "live";
    const res = await fetch(`/api/repos/${repoId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ syncMode: newMode }),
    });
    if (res.ok) {
      setRepos((prev) => prev.map((r) => (r.id === repoId ? { ...r, syncMode: newMode } : r)));
      toast(`Sync mode set to ${newMode === "live" ? "Live" : "Batch"}`);
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
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10 sm:px-10">
      <PageHeader
        title="Settings"
        description="Theme, sync behaviour, and the accounts SnapTriage signs in with."
      />

      <div className="mt-2 divide-y">
        {/* Appearance */}
        <section className="grid gap-5 py-8 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-8">
          <div className="min-w-0">
            <h2 className="text-base font-medium">Appearance</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Choose your preferred theme.
            </p>
          </div>
          <div className="min-w-0 lg:pt-0.5">
            <SegmentedControl
              ariaLabel="Theme"
              value={theme === "light" || theme === "dark" ? theme : "system"}
              onChange={setTheme}
              options={[
                { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
                { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
                { value: "system", label: "System", icon: <Monitor className="h-4 w-4" /> },
              ]}
            />
          </div>
        </section>

        {/* Sync Settings */}
        <section className="grid gap-5 py-8 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-8">
          <div className="min-w-0">
            <h2 className="text-base font-medium">Sync</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              How each repository fetches issues and writes your changes back.
            </p>
          </div>

          <div className="min-w-0">
            {repos.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                No repositories connected yet. Add one from the Repos page to configure sync.
              </p>
            ) : (
              <div className="divide-y">
                {repos.map((repo) => (
                  <div key={repo.id} className="py-6 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-2.5">
                        {repo.provider === "github" ? (
                          <GitHubIcon className="mt-0.5 h-4 w-4 shrink-0" />
                        ) : (
                          <GitLabIcon className="mt-0.5 h-4 w-4 shrink-0" />
                        )}
                        <span
                          className="min-w-0 break-words font-mono text-sm font-medium [overflow-wrap:anywhere]"
                          title={repo.fullName}
                        >
                          {repo.fullName}
                        </span>
                      </div>
                      <span className="shrink-0 rounded-md border px-2 py-1 text-xs text-muted-foreground">
                        {repo.permission}
                      </span>
                    </div>

                    <div className="mt-6 flex items-center justify-between gap-6">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">Auto-sync</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Fetch new issues every five minutes
                        </p>
                      </div>
                      <Switch
                        aria-label={`Auto-sync for ${repo.fullName}`}
                        checked={repo.syncEnabled}
                        onCheckedChange={() => handleSyncEnabledToggle(repo.id, repo.syncEnabled)}
                      />
                    </div>

                    <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="text-sm font-medium">Sync mode</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          {repo.syncMode === "live"
                            ? "Every change goes to the provider immediately"
                            : "Changes are staged until you push them"}
                        </p>
                      </div>
                      <SegmentedControl
                        ariaLabel={`Sync mode for ${repo.fullName}`}
                        value={repo.syncMode === "live" ? "live" : "batch"}
                        onChange={() => handleSyncModeToggle(repo.id, repo.syncMode)}
                        options={[
                          { value: "live", label: "Live", icon: <Zap className="h-4 w-4" /> },
                          { value: "batch", label: "Batch", icon: <Layers className="h-4 w-4" /> },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Connected Accounts */}
        <section className="grid gap-5 py-8 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-8">
          <div className="min-w-0">
            <h2 className="text-base font-medium">Connected accounts</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              The OAuth and token connections SnapTriage uses to reach your providers.
            </p>
          </div>
          <div className="min-w-0">
            {accounts.length === 0 ? (
              <p className="text-sm leading-relaxed text-muted-foreground">
                No accounts connected yet.
              </p>
            ) : (
              <div className="divide-y">
                {accounts.map((account) => (
                  <div
                    key={`${account.provider}-${account.providerAccountId}`}
                    className="flex items-center justify-between gap-3 py-4 first:pt-0 last:pb-0"
                  >
                    <div className="flex items-center gap-2.5">
                      {account.provider === "github" ? (
                        <GitHubIcon className="h-4 w-4" />
                      ) : (
                        <GitLabIcon className="h-4 w-4" />
                      )}
                      <span className="text-sm font-medium capitalize">{account.provider}</span>
                    </div>
                    <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                      {account.type === "oauth" ? "OAuth" : "PAT"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Keyboard Shortcuts */}
        <section className="grid gap-5 py-8 lg:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] lg:gap-8">
          <div className="min-w-0">
            <h2 className="text-base font-medium">Keyboard shortcuts</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              Press <span className="font-mono text-xs">?</span> in the inbox to see the full
              overlay and rebind any key.
            </p>
          </div>
          <ShortcutList className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,15rem),1fr))] gap-x-6 gap-y-3" />
        </section>
      </div>
    </div>
  );
}
