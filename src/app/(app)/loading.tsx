/**
 * @module app/(app)/loading
 * Loading skeleton for the authenticated app routes. Displays a centered
 * spinning indicator while the page content is being fetched or streamed
 * via React Suspense.
 */
import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
