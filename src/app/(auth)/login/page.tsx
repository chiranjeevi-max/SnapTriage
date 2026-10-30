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
    <main
      id="main-content"
      className="relative mx-auto flex min-h-dvh max-w-[var(--shell-width)] flex-col"
    >
      <header className="relative flex items-center justify-between border-b px-6 py-5 sm:px-10">
        <Wordmark href="/" />
        <ThemeToggle />
      </header>

      <div className="relative mx-auto grid w-full max-w-md flex-1 content-center gap-8 px-6 py-10 sm:px-10 md:max-w-6xl md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-12 md:py-16 lg:gap-16 lg:px-24">
        <div className="w-full max-w-sm justify-self-center self-center md:max-w-lg md:justify-self-end">
          <h1 className="text-4xl font-semibold leading-tight tracking-[-0.04em]">Sign in</h1>
          <p className="mt-5 max-w-[30ch] text-lg leading-relaxed text-muted-foreground">
            Open the triage queue for every repo you maintain.
          </p>
        </div>
        <div className="w-full max-w-sm justify-self-center border-t pt-8 md:justify-self-start md:border-t-0 md:border-l md:pl-10 md:pt-0">
          <div>
            <LoginForm />
          </div>
        </div>
      </div>

      <footer className="relative border-t px-6 py-6 text-xs text-muted-foreground sm:px-10">
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
