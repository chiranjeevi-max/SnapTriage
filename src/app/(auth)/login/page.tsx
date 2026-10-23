/**
 * @module app/(auth)/login/page
 * Sign-in page for SnapTriage. This server component checks whether the user
 * is already authenticated (redirecting to {@link /inbox} if so) and otherwise
 * renders the {@link LoginForm} with GitHub/GitLab OAuth and PAT sign-in.
 */
import Link from "next/link";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { LoginForm } from "@/features/auth/components/login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/inbox");

  return (
    <main id="main-content" className="relative flex min-h-screen flex-col">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-32 h-[420px] bg-[radial-gradient(60%_50%_at_50%_0%,var(--hero-glow),transparent_70%)]"
      />

      <header className="relative flex items-center justify-between px-5 py-5">
        <Wordmark href="/" />
        <ThemeToggle />
      </header>

      <div className="relative flex flex-1 items-center justify-center px-5 pb-20">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-[-0.02em]">Sign in</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Open the triage queue for every repo you maintain.
          </p>
          <div className="mt-8">
            <LoginForm />
          </div>
        </div>
      </div>

      <footer className="relative px-5 py-6 text-center text-xs text-muted-foreground">
        <Link
          href="/"
          className="underline-offset-4 transition-colors hover:text-foreground hover:underline"
        >
          Back to the home page
        </Link>
      </footer>
    </main>
  );
}
