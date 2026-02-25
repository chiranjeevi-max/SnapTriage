/**
 * @module app/(app)/layout
 * Layout for all authenticated application routes (inbox, repos, settings).
 * Wraps child pages in the {@link AppShell} component which provides the
 * sidebar navigation, top bar, and main content area.
 */
import { AppShell } from "@/features/repos/components/app-shell";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
