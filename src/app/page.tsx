/**
 * @module app/page
 * Landing page for SnapTriage. This server component checks the user's
 * authentication status: signed-in visitors go straight to their
 * {@link /inbox}, everyone else gets the public landing page.
 */
import type { Metadata } from "next";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { LandingPage } from "@/features/landing/components/landing-page";

export const metadata: Metadata = {
  title: "SnapTriage — clear the backlog without touching the mouse",
  description:
    "A keyboard-driven inbox for triaging GitHub and GitLab issues. One queue for every repo, with priority, labels, and assignees on the home row.",
  openGraph: {
    title: "SnapTriage — clear the backlog without touching the mouse",
    description:
      "A keyboard-driven inbox for triaging GitHub and GitLab issues. One queue for every repo.",
    type: "website",
  },
};

export default async function Home() {
  const session = await auth();

  if (session) {
    redirect("/inbox");
  }

  return <LandingPage />;
}
