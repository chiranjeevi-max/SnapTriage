/**
 * @module app/(app)/loading
 * Loading state for the authenticated app routes. Matches the settings page
 * spinner so every route hands over the same way.
 */
import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}
