/**
 * @module features/landing/components/landing-page
 *
 * The public landing page.
 *
 * The hero is the product: the triage queue beside the headline is the real
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
import { CopyCommand } from "@/features/landing/components/copy-command";
import { TriageDemo } from "@/features/landing/components/triage-demo";

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
      <header className="sticky top-0 z-50 border-b bg-background">
        <nav className="mx-auto flex h-16 max-w-[1440px] items-center justify-between px-5 sm:px-8 lg:px-12">
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
      </header>

      <main id="main-content">
        <section className="mx-auto grid grid-cols-1 max-w-[1440px] items-center gap-10 px-5 pt-12 pb-16 sm:px-8 lg:min-h-[704px] lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:gap-12 lg:px-12 lg:py-16">
          <div className="min-w-0">
            <h1 className="max-w-[12ch] text-balance text-[clamp(2.75rem,4.6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.045em]">
              Clear the backlog without touching the mouse.
            </h1>
            <p className="mt-6 max-w-[34ch] text-base leading-relaxed text-muted-foreground">
              Every issue from every repo you maintain, in one keyboard-driven queue.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button
                asChild
                size="lg"
                className="h-11 px-5 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
              >
                <Link href="/login">Sign in to start</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="h-11 bg-transparent px-5 active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transform-none"
              >
                <Link href="#self-host">Self-host it</Link>
              </Button>
            </div>
            <p className="mt-4 max-w-[34ch] text-sm leading-relaxed text-muted-foreground">
              Sign in with GitHub or GitLab, or paste a personal access token.
            </p>
          </div>

          <div className="min-w-0">
            <TriageDemo />
            <p className="mt-4 max-w-[60ch] text-xs leading-relaxed text-muted-foreground">
              A working slice of the inbox. Move with <Kbd>J</Kbd> and <Kbd>K</Kbd>, set priority
              with <Kbd>1</Kbd> to <Kbd>4</Kbd>, and label or assign without opening a dropdown.
              Press <Kbd>D</Kbd> to dismiss.
            </p>
          </div>
        </section>

        <section id="keys" className="scroll-mt-20 border-t">
          <div className="mx-auto grid grid-cols-1 max-w-[1440px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:gap-12 lg:px-12 lg:py-28">
            <div>
              <h2 className="text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.035em] sm:text-4xl">
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

        <section className="border-y bg-card">
          <div className="mx-auto grid grid-cols-1 max-w-[1440px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:px-12 lg:py-28">
            <div>
              <h2 className="max-w-[20ch] text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.035em] sm:text-4xl">
                Write it through, or stage it.
              </h2>
              <p className="mt-5 max-w-[54ch] leading-relaxed text-muted-foreground">
                Each repository picks how its changes reach the provider.
              </p>
            </div>
            <div className="grid gap-10 sm:grid-cols-2 sm:gap-8">
              <div>
                <h3 className="text-xl font-medium tracking-tight">Live</h3>
                <p className="mt-4 max-w-[44ch] leading-relaxed text-muted-foreground">
                  Every change is written to GitHub or GitLab as you make it. The row updates before
                  the request finishes, and rolls back if the provider refuses the write.
                </p>
                <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
                  Priority, labels and assignee are written on change
                </p>
              </div>
              <div>
                <h3 className="text-xl font-medium tracking-tight">Batch</h3>
                <p className="mt-4 max-w-[44ch] leading-relaxed text-muted-foreground">
                  Changes wait on the server until you push them. Nothing reaches the provider until
                  you say so, and the pending count tells you what is waiting.
                </p>
                <p className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
                  3 pending changes
                  <span className="rounded border px-1.5 py-0.5">Push</span>
                  <Kbd>Shift+P</Kbd>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section id="self-host" className="scroll-mt-20">
          <div className="mx-auto grid grid-cols-1 max-w-[1440px] gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)] lg:gap-12 lg:px-12 lg:py-28">
            <div>
              <h2 className="text-balance text-3xl font-semibold leading-[1.12] tracking-[-0.035em] sm:text-4xl">
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
                    <dd className="min-w-0 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                      {item.body}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="mt-10 border-t">
                <div className="flex items-center justify-between gap-4 py-3">
                  <span className="text-xs text-muted-foreground">Run with Docker</span>
                  <CopyCommand command={DEPLOY_COMMAND} />
                </div>
                <pre className="overflow-x-auto border-y bg-muted/40 px-4 py-4 font-mono text-xs leading-relaxed">
                  {DEPLOY_COMMAND}
                </pre>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1440px] flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
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
