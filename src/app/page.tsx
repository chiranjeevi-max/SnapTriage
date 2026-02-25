/**
 * @module app/page
 * Landing page for SnapTriage. This server component checks the user's
 * authentication status and redirects accordingly: authenticated users are
 * sent to {@link /inbox}, while unauthenticated visitors are sent to {@link /login}.
 * It renders no UI of its own.
 */
import { auth } from "@/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();

  if (session) {
    redirect("/inbox");
  } else {
    redirect("/login");
  }
}
