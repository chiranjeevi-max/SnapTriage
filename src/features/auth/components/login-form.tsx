/**
 * @module auth/components/login-form
 *
 * Sign-in form with two paths:
 * 1. **OAuth**: one-click buttons for GitHub and GitLab
 * 2. **PAT**: manual Personal Access Token entry with a provider toggle
 *
 * The PAT flow validates the token server-side via `/api/auth/token`
 * before initiating a Credentials sign-in.
 */
"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SegmentedControl } from "@/components/segmented-control";
import { GitLabIcon } from "@/components/icons/gitlab-icon";
import { GitHubIcon } from "@/components/icons/github-icon";

/** Providers that accept a personal access token. */
const tokenProviders = ["github", "gitlab"] as const;

/** Provider of a personal access token. */
type TokenProvider = (typeof tokenProviders)[number];

/** What a token has to look like and be able to do, per provider. */
const tokenHints: Record<TokenProvider, { placeholder: string; hint: string }> = {
  github: {
    placeholder: "ghp_...",
    hint: "Needs the repo scope so SnapTriage can read and update issues.",
  },
  gitlab: {
    placeholder: "glpat-...",
    hint: "Needs the api scope so SnapTriage can read and update issues.",
  },
};

/**
 * Full-page login form with OAuth and PAT sign-in options.
 * Manages its own loading/error state for the PAT validation flow.
 */
export function LoginForm() {
  const [token, setToken] = useState("");
  const [provider, setProvider] = useState<TokenProvider>("github");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hint = tokenHints[provider];

  /** Starts an OAuth sign-in, reporting a misconfigured provider instead of failing silently. */
  async function handleOAuth(target: TokenProvider) {
    setError(null);
    try {
      await signIn(target, { redirectTo: "/inbox" });
    } catch {
      const name = target === "github" ? "GitHub" : "GitLab";
      setError(`${name} sign-in is not configured on this deployment.`);
    }
  }

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
        setError(data.error || "That token was not accepted.");
        return;
      }

      // Token validated; sign in with credentials
      await signIn("credentials", {
        token: token.trim(),
        provider,
        redirectTo: "/inbox",
      });
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="grid gap-2.5">
        <Button
          variant="outline"
          size="lg"
          className="h-11 w-full justify-start gap-3 bg-card px-4"
          onClick={() => handleOAuth("github")}
        >
          <GitHubIcon className="h-4 w-4" />
          Continue with GitHub
        </Button>
        <Button
          variant="outline"
          size="lg"
          className="h-11 w-full justify-start gap-3 bg-card px-4"
          onClick={() => handleOAuth("gitlab")}
        >
          <GitLabIcon className="h-4 w-4" />
          Continue with GitLab
        </Button>
      </div>

      <div className="relative">
        <Separator />
        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-background px-2 text-xs text-muted-foreground">
          or
        </span>
      </div>

      <form onSubmit={handleTokenSubmit} className="space-y-5">
        <div className="grid justify-items-start gap-3">
          <span className="block text-sm font-medium">Token provider</span>
          <SegmentedControl
            ariaLabel="Token provider"
            value={provider}
            onChange={setProvider}
            options={tokenProviders.map((option) => ({
              value: option,
              label: option === "github" ? "GitHub" : "GitLab",
              icon:
                option === "github" ? (
                  <GitHubIcon className="h-3.5 w-3.5" />
                ) : (
                  <GitLabIcon className="h-3.5 w-3.5" />
                ),
            }))}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="token">Personal access token</Label>
          <Input
            id="token"
            className="h-11 bg-card px-3"
            type="password"
            placeholder={hint.placeholder}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            aria-describedby="token-hint"
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <p id="token-hint" className="text-xs leading-relaxed text-muted-foreground">
            {hint.hint}
          </p>
        </div>

        {error && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs leading-relaxed text-destructive"
          >
            <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <Button type="submit" className="h-11 w-full" disabled={loading || !token.trim()}>
          {loading ? "Checking token..." : "Continue with token"}
        </Button>
      </form>
    </div>
  );
}
