/**
 * @module components/providers
 * Client-side provider stack that wraps the entire application. Composes
 * the following providers from outermost to innermost:
 *
 * 1. **SessionProvider** (next-auth) -- exposes authentication session via React context
 * 2. **QueryClientProvider** (TanStack Query) -- manages server-state caching and refetching
 * 3. **ThemeProvider** (next-themes) -- handles dark/light/system theme with class strategy
 * 4. **TooltipProvider** (shadcn/ui) -- enables tooltip primitives throughout the app
 *
 * Also renders the global {@link Toaster} (Sonner) for toast notifications.
 */
"use client";

import { useState } from "react";
import { SessionProvider } from "next-auth/react";
import { ThemeProvider } from "next-themes";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <SessionProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          <TooltipProvider>
            {children}
            <Toaster richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SessionProvider>
  );
}
