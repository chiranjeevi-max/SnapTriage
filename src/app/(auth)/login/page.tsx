/**
 * @module app/(auth)/login/page
 * Login page for SnapTriage. This server component checks whether the user is
 * already authenticated (redirecting to {@link /inbox} if so) and otherwise
 * renders the {@link LoginForm} with GitHub/GitLab OAuth and PAT sign-in options.
 */
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { LoginForm } from "@/features/auth/components/login-form";

export default async function LoginPage() {
  const session = await auth();
  if (session) redirect("/inbox");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <LoginForm />
    </div>
  );
}
