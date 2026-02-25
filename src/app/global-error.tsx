/**
 * @module app/global-error
 * Global error boundary for the entire SnapTriage application. This is the
 * last-resort error handler that catches errors escaping the root layout.
 * It renders its own minimal `<html>` / `<body>` shell with an error message
 * and a "Try again" button because the root layout may itself be broken.
 */
"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <div className="mx-auto max-w-md text-center">
            <AlertTriangle className="mx-auto h-12 w-12 text-destructive" />
            <h2 className="mt-4 text-xl font-semibold">Something went wrong</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              An unexpected error occurred. Please try again.
            </p>
            <Button onClick={reset} className="mt-6">
              Try again
            </Button>
          </div>
        </div>
      </body>
    </html>
  );
}
