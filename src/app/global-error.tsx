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
import { EmptyState } from "@/components/empty-state";
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
        <main className="flex min-h-screen items-center justify-center bg-background p-6">
          <EmptyState
            icon={<AlertTriangle className="h-5 w-5 text-destructive" />}
            titleAs="h1"
            title="Something went wrong"
            description="The app hit an error it could not recover from. Reloading usually clears it."
            action={
              <Button onClick={reset} size="sm">
                Try again
              </Button>
            }
            className="max-w-sm"
          />
        </main>
      </body>
    </html>
  );
}
