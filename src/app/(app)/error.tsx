/**
 * @module app/(app)/error
 * Error boundary for the authenticated app routes. Catches runtime errors
 * within the (app) layout group, logs them to the console, and renders
 * a user-friendly message with a "Try again" button that triggers a re-render.
 */
"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
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
    <div className="flex h-full items-center justify-center p-4">
      <div className="mx-auto max-w-md text-center">
        <AlertTriangle className="mx-auto h-10 w-10 text-destructive" />
        <h2 className="mt-4 text-lg font-semibold">Something went wrong</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error.message || "An unexpected error occurred."}
        </p>
        <Button onClick={reset} variant="outline" className="mt-4">
          Try again
        </Button>
      </div>
    </div>
  );
}
