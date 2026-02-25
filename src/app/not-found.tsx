/**
 * @module app/not-found
 * Custom 404 page for SnapTriage. Displays a large "404" heading, a brief
 * explanation, and a button linking back to the inbox so users can recover
 * from mistyped or stale URLs.
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="mx-auto max-w-md text-center">
        <h1 className="text-6xl font-bold text-muted-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>
        <Button asChild className="mt-6">
          <Link href="/inbox">Go to Inbox</Link>
        </Button>
      </div>
    </div>
  );
}
