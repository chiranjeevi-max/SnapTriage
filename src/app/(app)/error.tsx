/**
 * @module app/(app)/error
 * Error boundary for the authenticated app routes. Catches runtime errors
 * within the (app) layout group, logs them to the console, and renders
 * a user-friendly message with a "Try again" button that triggers a re-render.
 */
"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="flex h-full items-center justify-center p-6">
      <EmptyState
        icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
        titleAs="h1"
        title="Something went wrong"
        description={error.message || "An unexpected error occurred."}
        action={
          <Button onClick={reset} variant="outline" size="sm">
            Try again
          </Button>
        }
        className="max-w-sm"
      />
    </div>
  );
}
