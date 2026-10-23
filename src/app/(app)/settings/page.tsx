/**
 * @module app/(app)/settings/page
 * Settings page for SnapTriage. Provides UI sections for theme selection
 * (light/dark/system), per-repository sync configuration (auto-sync toggle
 * and live vs. batch sync mode), connected OAuth/PAT accounts overview,
 * and a keyboard shortcuts reference.
 */
"use client";

import { useEffect, useState } from "react";
import { Loader2, Moon, Sun, Monitor } from "lucide-react";
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
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <PageHeader
        title="Settings"
        description="Theme, sync behaviour, and the accounts SnapTriage signs in with."
      />

      <div className="mt-8 space-y-10">
        {/* Appearance */}
        <section>
          <h2 className="text-sm font-medium">Appearance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose your preferred theme.</p>
          <div className="mt-3">
            <SegmentedControl
              ariaLabel="Theme"
              value={theme === "light" || theme === "dark" ? theme : "system"}
              onChange={setTheme}
              options={[
                { value: "light", label: "Light", icon: <Sun className="h-3.5 w-3.5" /> },
                { value: "dark", label: "Dark", icon: <Moon className="h-3.5 w-3.5" /> },
                { value: "system", label: "System", icon: <Monitor className="h-3.5 w-3.5" /> },
              ]}
            />
          </div>
        </section>

        {/* Sync Settings */}
        <section className="border-t pt-8">
          <h2 className="text-sm font-medium">Sync</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            How each repository fetches issues and writes your changes back.
          </p>

          {repos.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No repositories connected yet. Add one from the Repos page to configure sync.
            </p>
          ) : (
            <div className="mt-4 divide-y border-y">
              {repos.map((repo) => (
                <div key={repo.id} className="py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {repo.provider === "github" ? (
                        <GitHubIcon className="h-4 w-4 shrink-0" />
                      ) : (
                        <GitLabIcon className="h-4 w-4 shrink-0" />
                      )}
                      <span className="truncate text-sm font-medium" title={repo.fullName}>
                        {repo.fullName}
                      </span>
                    </div>
                    <span className="shrink-0 rounded border px-1.5 py-px font-mono text-[10px] leading-4 text-muted-foreground">
                      {repo.permission}
                    </span>
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm">Auto-sync</p>
                      <p className="text-xs text-muted-foreground">
                        Fetch new issues every five minutes
                      </p>
                    </div>
                    <Switch
                      checked={repo.syncEnabled}
                      onCheckedChange={() => handleSyncEnabledToggle(repo.id, repo.syncEnabled)}
                    />
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm">Sync mode</p>
                      <p className="text-xs text-muted-foreground">
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
                        {
                          value: "live",
                          label: "Live",
                          icon: <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />,
                        },
                        {
                          value: "batch",
                          label: "Batch",
                          icon: <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />,
                        },
                      ]}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Connected Accounts */}
        <section className="border-t pt-8">
          <h2 className="text-sm font-medium">Connected accounts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The OAuth and token connections SnapTriage uses to reach your providers.
          </p>

          {accounts.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No accounts connected yet.</p>
          ) : (
            <div className="mt-4 divide-y border-y">
              {accounts.map((account) => (
                <div
                  key={`${account.provider}-${account.providerAccountId}`}
                  className="flex items-center justify-between gap-3 py-3"
                >
                  <div className="flex items-center gap-2">
                    {account.provider === "github" ? (
                      <GitHubIcon className="h-4 w-4" />
                    ) : (
                      <GitLabIcon className="h-4 w-4" />
                    )}
                    <span className="text-sm font-medium capitalize">{account.provider}</span>
                  </div>
                  <span className="rounded border px-1.5 py-px font-mono text-[10px] leading-4 text-muted-foreground">
                    {account.type === "oauth" ? "OAuth" : "PAT"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Keyboard Shortcuts */}
        <section className="border-t pt-8">
          <h2 className="text-sm font-medium">Keyboard shortcuts</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Press <span className="font-mono text-xs">?</span> in the inbox to see the full overlay
            and rebind any key.
          </p>
          <ShortcutList className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2" />
        </section>
      </div>
    </div>
  );
}
