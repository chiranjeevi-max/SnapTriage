/**
 * @module repos/components/app-shell
 *
 * Application shell layout with sidebar navigation, connected repo list,
 * user menu, theme toggle, and keyboard shortcut button.
 * Wraps the main content area for all authenticated (app) routes.
 */
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, FolderGit2, Settings, Github, Keyboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { UserMenu } from "@/features/auth/components/user-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useKeyboardStore } from "@/features/keyboard";

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
 * Fetches connected repos on every route change to keep the sidebar current.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [repos, setRepos] = useState<ConnectedRepo[]>([]);
  const toggleOverlay = useKeyboardStore((s) => s.toggleOverlay);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/repos")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setRepos(data);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className="flex w-56 shrink-0 flex-col border-r bg-muted/30"
        aria-label="Main navigation"
      >
        <div className="flex h-14 items-center border-b px-4">
          <Link href="/inbox" className="text-lg font-bold">
            SnapTriage
          </Link>
        </div>

        {/* Navigation */}
        <nav className="space-y-1 p-2" aria-label="App navigation">
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              )}
            >
              <Icon className="h-4 w-4" />
              {label}
            </Link>
          ))}
        </nav>

        {/* Connected repos */}
        {repos.length > 0 && (
          <div className="mt-4 flex-1 overflow-y-auto border-t px-2 pt-3">
            <p className="mb-2 px-3 text-xs font-semibold uppercase text-muted-foreground">Repos</p>
            <div className="space-y-0.5">
              {repos.map((repo) => (
                <div
                  key={repo.id}
                  className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground"
                >
                  {repo.provider === "github" ? (
                    <Github className="h-3.5 w-3.5 shrink-0" />
                  ) : (
                    <GitLabIcon className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="truncate">{repo.fullName}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User menu at bottom */}
        <div className="mt-auto border-t p-3">
          <div className="flex items-center justify-between">
            <UserMenu />
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleOverlay}>
                    <Keyboard className="h-4 w-4" />
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
      <main id="main-content" className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  );
}

/** Inline GitLab logo SVG. */
function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}
