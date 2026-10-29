/**
 * @module repos/components/app-shell
 *
 * Application shell layout with sidebar navigation, connected repo list,
 * user menu, theme toggle, and keyboard shortcut button.
 * Wraps the main content area for all authenticated (app) routes.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Inbox, FolderGit2, Settings, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { Wordmark } from "@/components/brand";
import { UserMenu } from "@/features/auth/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useKeyboardStore } from "@/features/keyboard";
import { devRepos, readDataMode } from "@/features/dev-tools/data-mode";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import { GitHubIcon } from "@/components/icons/github-icon";

/** Shape of a connected repo record returned by the repos API. */
interface ConnectedRepo {
  id: string;
  provider: string;
  fullName: string;
  permission: string;
}

/** Sidebar navigation links. */
const navItems = [
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/repos", label: "Repos", icon: FolderGit2 },
  { href: "/settings", label: "Settings", icon: Settings },
];

/**
 * Application shell with sidebar navigation, connected repos, and user menu.
 * Uses TanStack Query to cache connected repos for efficient sidebar rendering.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const toggleOverlay = useKeyboardStore((s) => s.toggleOverlay);

  const { data: repos = [] } = useQuery<ConnectedRepo[]>({
    queryKey: ["connected-repos"],
    queryFn: async () => {
      // The dev-only data toggle swaps the real repos for the worst case.
      const fixture = await devRepos(readDataMode());
      if (fixture) return fixture;
      return fetch("/api/repos").then((res) => (res.ok ? res.json() : []));
    },
    staleTime: 60_000,
  });

  return (
    <div className="app-shell">
      {/* Sidebar */}
      <aside className="app-sidebar" aria-label="Main navigation">
        <div className="app-brand">
          <Wordmark href="/inbox" size="sm" />
        </div>

        {/* Navigation */}
        <nav className="app-navigation" aria-label="App navigation">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "app-nav-link",
                  active
                    ? "is-active text-foreground"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>

        {/* Connected repos */}
        {repos.length > 0 && (
          <div className="app-repositories">
            <p className="mb-3 flex items-center justify-between px-3 text-xs font-medium text-muted-foreground">
              Repos <span className="font-mono tabular-nums">{repos.length}</span>
            </p>
            <div className="space-y-0.5">
              {repos.map((repo) => (
                <div
                  key={repo.id}
                  className="flex min-w-0 items-start gap-2.5 rounded-md px-3 py-2 text-xs text-muted-foreground"
                >
                  {repo.provider === "github" ? (
                    <GitHubIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <GitLabIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  )}
                  <span
                    className="min-w-0 break-all font-mono leading-relaxed"
                    title={repo.fullName}
                  >
                    {repo.fullName}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User menu at bottom */}
        <div className="app-sidebar-footer">
          <div className="flex items-center justify-between">
            <UserMenu />
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleOverlay}>
                    <Keyboard className="h-4 w-4" />
                    <span className="sr-only">Keyboard shortcuts</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">Keyboard shortcuts (?)</TooltipContent>
              </Tooltip>
              <ThemeToggle />
            </div>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main id="main-content" className="app-shell-content">
        {children}
      </main>
    </div>
  );
}
