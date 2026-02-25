/**
 * @module auth/components/login-form
 *
 * Login page component providing two authentication paths:
 * 1. **OAuth** — One-click buttons for GitHub and GitLab
 * 2. **PAT** — Manual Personal Access Token entry with provider toggle
 *
 * The PAT flow validates the token server-side via `/api/auth/token`
 * before initiating a Credentials sign-in.
 */
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Github } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

/**
 * Full-page login form with OAuth and PAT sign-in options.
 * Manages its own loading/error state for the PAT validation flow.
 */
export function LoginForm() {
  const [token, setToken] = useState("");
  const [provider, setProvider] = useState<"github" | "gitlab">("github");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Validates the PAT server-side, then initiates a Credentials sign-in. */
  async function handleTokenSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/auth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim(), provider }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Invalid token");
        return;
      }

      // Token validated — sign in with credentials
      await signIn("credentials", {
        token: token.trim(),
        provider,
        redirectTo: "/inbox",
      });
    } catch {
      setError("Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <CardTitle className="text-2xl font-bold">SnapTriage</CardTitle>
        <CardDescription>Sign in to start triaging issues</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* OAuth buttons */}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => signIn("github", { redirectTo: "/inbox" })}
        >
          <Github className="mr-2 h-4 w-4" />
          Continue with GitHub
        </Button>

        <Button
          variant="outline"
          className="w-full"
          onClick={() => signIn("gitlab", { redirectTo: "/inbox" })}
        >
          <GitLabIcon className="mr-2 h-4 w-4" />
          Continue with GitLab
        </Button>

        <div className="relative">
          <Separator />
          <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
            OR
          </span>
        </div>

        {/* PAT form */}
        <form onSubmit={handleTokenSubmit} className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <div className="flex gap-2">
              <Button
                type="button"
                variant={provider === "github" ? "default" : "outline"}
                size="sm"
                onClick={() => setProvider("github")}
              >
                GitHub
              </Button>
              <Button
                type="button"
                variant={provider === "gitlab" ? "default" : "outline"}
                size="sm"
                onClick={() => setProvider("gitlab")}
              >
                GitLab
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="token">Personal Access Token</Label>
            <Input
              id="token"
              type="password"
              placeholder="ghp_... or glpat-..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" className="w-full" disabled={loading || !token.trim()}>
            {loading ? "Validating..." : "Sign in with Token"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Inline GitLab logo SVG (lucide-react doesn't include a GitLab icon). */
function GitLabIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M22.65 14.39 12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z" />
    </svg>
  );
}
