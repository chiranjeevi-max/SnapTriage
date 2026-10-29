/**
 * @module auth/components/user-menu
 *
 * Avatar dropdown menu shown in the app header.
 * Displays the authenticated user's avatar and name, with links to
 * settings and a sign-out action.
 */
"use client";

import { useSession, signOut } from "next-auth/react";
import { LogOut, Settings, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import Link from "next/link";

/**
 * Authenticated user menu with avatar trigger and dropdown actions.
 * Returns `null` when no session is active (unauthenticated state).
 */
export function UserMenu() {
  const { data: session } = useSession();

  if (!session?.user) return null;

  const initials = session.user.name
    ?.split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="relative h-11 w-11 rounded-full sm:h-8 sm:w-8"
          aria-label="Account menu"
        >
          <Avatar className="h-8 w-8">
            <AvatarImage src={session.user.image ?? undefined} alt="" />
            <AvatarFallback>{initials ?? <User className="h-4 w-4" />}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-64 max-w-[var(--radix-dropdown-menu-content-available-width)]"
      >
        <div className="flex min-w-0 items-center gap-2 p-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
              {session.user.name}
            </p>
            <p className="break-all text-xs leading-relaxed text-muted-foreground">
              {session.user.email}
            </p>
          </div>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className="min-h-11">
          <Link href="/settings">
            <Settings className="h-4 w-4" />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="min-h-11" onClick={() => signOut({ redirectTo: "/login" })}>
          <LogOut className="h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
