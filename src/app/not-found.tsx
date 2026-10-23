/**
 * @module app/not-found
 * Custom 404 page for SnapTriage. Displays a brief explanation and a button
 * linking back to the inbox so users can recover from mistyped or stale URLs.
 */
import Link from "next/link";
import { FileQuestion } from "lucide-react";
import { Wordmark } from "@/components/brand";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main id="main-content" className="flex min-h-screen flex-col">
      <header className="px-5 py-5">
        <Wordmark href="/" />
      </header>
      <div className="flex flex-1 items-center justify-center px-5 pb-20">
        <EmptyState
          icon={<FileQuestion className="h-5 w-5" />}
          titleAs="h1"
          title="This page does not exist"
          description="The link may be out of date, or the page may have moved."
          action={
            <Button asChild size="sm">
              <Link href="/inbox">Go to the inbox</Link>
            </Button>
          }
          className="max-w-sm"
        />
      </div>
    </main>
  );
}
