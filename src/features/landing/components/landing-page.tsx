/**
 * @module features/landing/components/landing-page
 *
 * The public landing page.
 *
 * The hero is the product: the triage queue below the headline is the real
 * interface, running and accepting keystrokes, so a visitor can try the app
 * before deciding to sign in. Everything under the hero is reference material
 * for people who already know what they want.
 */
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/brand";
import { Kbd } from "@/features/keyboard/components/kbd";
import { ShortcutGroups } from "@/features/keyboard/components/shortcut-list";
import { CopyCommand } from "./copy-command";
import { TriageDemo } from "./triage-demo";

/** Command that starts a self-hosted instance. */
const DEPLOY_COMMAND = [
  "git clone https://github.com/chiranjeevi-max/SnapTriage.git",
  "cd SnapTriage",
  "docker compose -f docker/docker-compose.yml up",
].join("\n");

/** How the app handles the credentials it stores. */
const TRUST_ITEMS = [
  {
    title: "Tokens are encrypted at rest",
    body: "AES-256-GCM, with the key derived from your AUTH_SECRET. A token that fails to decrypt is rejected and logged, never handed back.",
  },
  {
    title: "Scripts need a per-request nonce",
    body: "The Content-Security-Policy is rebuilt for every request, so an injected script has nothing to match.",
  },
  {
    title: "Webhook secrets stay in headers",
    body: "X-Hub-Signature-256 for GitHub, X-Gitlab-Token for GitLab. The secret never appears in a URL.",
  },
  {
    title: "SQLite by default, Postgres when you want it",
    body: "One Drizzle schema, two backends. A laptop install needs no database server at all.",
  },
];

/** The public landing page. */
export function LandingPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50">
        <div className="landing-chrome absolute inset-0 -z-10 bg-background/70 backdrop-blur-xl" />
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Wordmark href="/" />
          <div className="flex items-center gap-1">
            <a
              href="#keys"
              className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Shortcuts
            </a>
            <a
              href="#self-host"
              className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground sm:block"
            >
              Self-host
            </a>
            <ThemeToggle />
            <Button asChild size="sm" className="ml-1.5">
              <Link href="/login">Sign in</Link>
            </Button>
          </div>
        </nav>
        <div className="pointer-events-none absolute inset-x-0 top-full h-6 bg-gradient-to-b from-background/90 to-transparent" />
      </header>

      <main id="main-content">
        <section className="relative mx-auto max-w-6xl px-5 pt-14 pb-20 sm:pt-20">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 -top-32 h-[480px] bg-[radial-gradient(60%_50%_at_50%_0%,var(--hero-glow),transparent_70%)]"
          />
          <div className="relative">
            <h1 className="max-w-[16ch] text-balance text-[clamp(2.5rem,7vw,4.25rem)] font-semibold leading-[1.02] tracking-[-0.035em]">
              Clear the backlog without touching the mouse.
            </h1>
            <p className="mt-6 max-w-[54ch] text-lg leading-relaxed text-muted-foreground">
              SnapTriage pulls every issue from every repo you maintain into one queue. Move with{" "}
              <Kbd>J</Kbd> and <Kbd>K</Kbd>, set priority with <Kbd>1</Kbd> to <Kbd>4</Kbd>, and
              label or assign without opening a dropdown.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="duration-100 ease-out active:scale-[0.98]">
                <Link href="/login">Sign in to start</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="duration-100 ease-out active:scale-[0.98]"
              >
                <Link href="#self-host">Self-host it</Link>
              </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">
              Sign in with GitHub or GitLab, or paste a personal access token.
            </p>
          </div>

          <div className="relative mt-12">
            <TriageDemo />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              A working slice of the inbox. Press J to move, 1 to 4 for priority, D to dismiss.
            </p>
          </div>
        </section>

        <section id="keys" className="scroll-mt-20 border-t">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <div>
              <h2 className="text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-4xl">
                Every action has a key.
              </h2>
              <p className="mt-5 max-w-[46ch] leading-relaxed text-muted-foreground">
                Triage is a queue job: read it, sort it, move on. These are the app&apos;s own
                bindings, and any of them can be rebound from the <Kbd>?</Kbd> overlay.
              </p>
            </div>
            <ShortcutGroups />
          </div>
        </section>

        <section className="border-y bg-muted/30">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <h2 className="max-w-[20ch] text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-4xl">
              Write it through, or stage it.
            </h2>
            <p className="mt-5 max-w-[54ch] leading-relaxed text-muted-foreground">
              Each repository picks how its changes reach the provider.
            </p>
            <div className="mt-14 grid gap-12 sm:grid-cols-2">
              <div>
                <h3 className="flex items-center gap-2.5 text-lg font-medium">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-emerald-500" />
                  Live
                </h3>
                <p className="mt-4 max-w-[44ch] leading-relaxed text-muted-foreground">
                  Every change is written to GitHub or GitLab as you make it. The row updates before
                  the request finishes, and rolls back if the provider refuses the write.
                </p>
                <p className="mt-5 font-mono text-xs text-muted-foreground">
                  priority · labels · assignee → written on change
                </p>
              </div>
              <div>
                <h3 className="flex items-center gap-2.5 text-lg font-medium">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full bg-amber-500" />
                  Batch
                </h3>
                <p className="mt-4 max-w-[44ch] leading-relaxed text-muted-foreground">
                  Changes wait on the server until you push them. Nothing reaches the provider until
                  you say so, and the pending count tells you what is waiting.
                </p>
                <p className="mt-5 flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  3 pending changes
                  <span className="rounded border px-1.5 py-0.5">Push</span>
                  <span className="rounded border px-1.5 py-0.5">Shift+P</span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="self-host" className="scroll-mt-20">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <div>
              <h2 className="text-balance text-3xl font-semibold leading-[1.08] tracking-[-0.025em] sm:text-4xl">
                Your tokens stay yours.
              </h2>
              <p className="mt-5 max-w-[46ch] leading-relaxed text-muted-foreground">
                SnapTriage stores the access tokens it needs to reach your providers, and it stores
                them encrypted. Run it on a laptop, a NAS, or a small server.
              </p>
            </div>
            <div>
              <dl className="divide-y border-y">
                {TRUST_ITEMS.map((item) => (
                  <div
                    key={item.title}
                    className="grid gap-2 py-5 sm:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] sm:gap-6"
                  >
                    <dt className="text-sm font-medium">{item.title}</dt>
                    <dd className="text-sm leading-relaxed text-muted-foreground">{item.body}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-10 overflow-hidden rounded-lg border">
                <div className="flex items-center justify-between border-b bg-muted/40 px-4 py-2">
                  <span className="font-mono text-xs text-muted-foreground">terminal</span>
                  <CopyCommand command={DEPLOY_COMMAND} />
                </div>
                <pre className="overflow-x-auto px-4 py-4 font-mono text-xs leading-relaxed">
                  {DEPLOY_COMMAND}
                </pre>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <Wordmark href="/" size="sm" />
          </div>
          <p className="text-sm text-muted-foreground">
            MIT licensed. Built for maintainers with a backlog.
          </p>
          <div className="flex items-center gap-5 text-sm">
            <a
              href="https://github.com/chiranjeevi-max/SnapTriage"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              GitHub
            </a>
            <Link
              href="/login"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
