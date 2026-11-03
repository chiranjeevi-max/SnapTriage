/**
 * @module tests/unit/features/auth/pat-provider.spec.ts
 * Which user a Personal Access Token signs in as. Runs against a real
 * in-memory database; only the providers' `/user` endpoints are faked.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { typedDb } from "@/lib/db/query";
import { accessTokens, accounts, rateLimitBuckets, users } from "@/lib/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { authorizePat } from "@/features/auth/pat-provider";
import { authLogger } from "@/lib/logger";

vi.hoisted(() => {
  process.env.SQLITE_PATH = ":memory:";
  process.env.AUTH_SECRET = "test-secret";
  delete process.env.DATABASE_URL;
  delete process.env.AUTH_GITLAB_URL;
});

/** What the fake provider answers for a token: an account, or a bare HTTP status. */
type FakeAccount = { id: number; email: string | null } | number;

/** Stands in for GitHub's and GitLab's `/user` endpoints, keyed by token. */
function stubProviders(tokens: Record<string, FakeAccount>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const token =
        headers.get("private-token") ?? headers.get("authorization")?.replace(/^Bearer /, "");
      const account = tokens[token ?? ""] ?? 401;
      if (typeof account === "number") return new Response(null, { status: account });
      return Response.json({
        id: account.id,
        login: `user${account.id}`,
        username: `user${account.id}`,
        name: null,
        email: account.email,
        avatar_url: `https://avatars.example.com/${account.id}`,
      });
    })
  );
}

function signInRequest() {
  return new Request("http://localhost/api/auth/callback/credentials", { method: "POST" });
}

/** Signs in with a token and returns the user id, failing the test if sign-in is refused. */
async function signIn(token: string, provider: "github" | "gitlab"): Promise<string> {
  const user = await authorizePat({ token, provider }, signInRequest());
  if (!user?.id) throw new Error(`sign-in with ${token} was refused`);
  return user.id;
}

function storedTokensOf(userId: string) {
  return typedDb.select().from(accessTokens).where(eq(accessTokens.userId, userId));
}

function usersNamed(name: string) {
  return typedDb.select().from(users).where(eq(users.name, name));
}

/** Stores a PAT the way sign-in did before it recorded the provider account. */
async function seedLegacyPat(userId: string, provider: "github" | "gitlab", token: string) {
  await typedDb.insert(accessTokens).values({ userId, provider, token, label: `${provider}-pat` });
}

describe("authorizePat", () => {
  beforeAll(() => {
    migrate(typedDb, { migrationsFolder: join(process.cwd(), "drizzle") });
  });

  beforeEach(async () => {
    // Every sign-in here shares the unattributed bucket; give each test a full allowance.
    await typedDb.delete(rateLimitBuckets);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("does not hand an OAuth user's legacy row to another account at the same instance", async () => {
    // The old email match could store an impostor's token on an OAuth user's row.
    await typedDb
      .insert(users)
      .values({ id: "oauth-victim", name: "Victim", email: "taken@example.com" });
    await typedDb.insert(accounts).values({
      userId: "oauth-victim",
      type: "oauth",
      provider: "github",
      providerAccountId: "2000",
    });
    await seedLegacyPat("oauth-victim", "github", encrypt("ghp-impostor-old"));
    stubProviders({
      "ghp-impostor-old": { id: 2100, email: "taken@example.com" },
      "ghp-impostor-new": { id: 2100, email: "taken@example.com" },
    });

    expect(await signIn("ghp-impostor-new", "github")).not.toBe("oauth-victim");
  });

  it("keeps a malformed token out of the failure log", async () => {
    const logged = vi.spyOn(authLogger, "error");
    stubProviders({});

    const user = await authorizePat(
      { token: "ghp-line\nbreak", provider: "github" },
      signInRequest()
    );

    expect(user).toBeNull();
    expect(JSON.stringify(logged.mock.calls)).not.toContain("ghp-line");
  });

  it("does not sign in to another user who has the same email", async () => {
    await typedDb
      .insert(users)
      .values({ id: "victim", name: "Victim", email: "victim@example.com" });
    await typedDb
      .insert(accounts)
      .values({ userId: "victim", type: "oauth", provider: "github", providerAccountId: "100" });
    stubProviders({ "glpat-imposter": { id: 200, email: "victim@example.com" } });

    expect(await signIn("glpat-imposter", "gitlab")).not.toBe("victim");
    expect(await storedTokensOf("victim")).toEqual([]);
  });

  it("signs a provider account without an email in to the same user every time", async () => {
    stubProviders({ "ghp-private": { id: 300, email: null } });

    const first = await signIn("ghp-private", "github");
    const second = await signIn("ghp-private", "github");

    expect(second).toBe(first);
    expect(await usersNamed("user300")).toHaveLength(1);
  });

  it("signs a PAT in to the OAuth user of the same provider account", async () => {
    await typedDb
      .insert(users)
      .values({ id: "oauth-user", name: "OAuth", email: "primary@example.com" });
    await typedDb.insert(accounts).values({
      userId: "oauth-user",
      type: "oauth",
      provider: "github",
      providerAccountId: "400",
    });
    stubProviders({ "ghp-oauth-user": { id: 400, email: null } });

    expect(await signIn("ghp-oauth-user", "github")).toBe("oauth-user");
    expect(await storedTokensOf("oauth-user")).toMatchObject([
      { provider: "github", providerAccountId: "github.com/400" },
    ]);
  });

  it("keeps signing in to the user holding the PAT when an OAuth link names another", async () => {
    await typedDb.insert(users).values([
      { id: "pat-holder", name: "PAT holder", email: null },
      { id: "oauth-holder", name: "OAuth holder", email: "oauth-holder@example.com" },
    ]);
    await typedDb.insert(accessTokens).values({
      userId: "pat-holder",
      provider: "github",
      providerAccountId: "github.com/450",
      token: encrypt("ghp-earlier"),
      label: "github-pat",
    });
    await typedDb.insert(accounts).values({
      userId: "oauth-holder",
      type: "oauth",
      provider: "github",
      providerAccountId: "450",
    });
    stubProviders({ "ghp-later": { id: 450, email: null } });

    expect(await signIn("ghp-later", "github")).toBe("pat-holder");
  });

  it("keeps a user whose PAT predates account ids when the stored token is the same account", async () => {
    await typedDb
      .insert(users)
      .values({ id: "legacy", name: "Legacy", email: "legacy@example.com" });
    await seedLegacyPat("legacy", "github", encrypt("ghp-old"));
    stubProviders({
      "ghp-old": { id: 500, email: "legacy@example.com" },
      "ghp-new": { id: 500, email: "legacy@example.com" },
    });

    expect(await signIn("ghp-new", "github")).toBe("legacy");
    const [stored] = await storedTokensOf("legacy");
    expect(stored.providerAccountId).toBe("github.com/500");
    expect(decrypt(stored.token)).toBe("ghp-new");
  });

  it("prefers a legacy PAT user over an OAuth user of the same account", async () => {
    // Auth.js lowercases OAuth addresses while the old PAT lookup matched them
    // exactly, so a mixed-case address kept these two users apart.
    await typedDb.insert(users).values([
      { id: "oauth-twin", name: "OAuth twin", email: "mixed@example.com" },
      { id: "pat-twin", name: "PAT twin", email: "Mixed@Example.com" },
    ]);
    await typedDb.insert(accounts).values({
      userId: "oauth-twin",
      type: "oauth",
      provider: "github",
      providerAccountId: "1000",
    });
    await seedLegacyPat("pat-twin", "github", encrypt("ghp-twin-old"));
    stubProviders({
      "ghp-twin-old": { id: 1000, email: "Mixed@Example.com" },
      "ghp-twin-new": { id: 1000, email: "Mixed@Example.com" },
    });

    expect(await signIn("ghp-twin-new", "github")).toBe("pat-twin");
  });

  it("signs an OAuth user with an unclaimed legacy PAT in without checking the stored token", async () => {
    await typedDb
      .insert(users)
      .values({ id: "both-ways", name: "Both", email: "both@example.com" });
    await typedDb.insert(accounts).values({
      userId: "both-ways",
      type: "oauth",
      provider: "github",
      providerAccountId: "1400",
    });
    await seedLegacyPat("both-ways", "github", encrypt("ghp-both-old"));
    // The OAuth link already proves the account, so a rate-limited check must not matter.
    stubProviders({ "ghp-both-old": 429, "ghp-both-new": { id: 1400, email: "both@example.com" } });

    expect(await signIn("ghp-both-new", "github")).toBe("both-ways");
  });

  it("does not hand a legacy user to a different account with the same email", async () => {
    await typedDb
      .insert(users)
      .values({ id: "legacy-owner", name: "Owner", email: "shared@example.com" });
    await seedLegacyPat("legacy-owner", "gitlab", encrypt("glpat-owner"));
    stubProviders({
      "glpat-owner": { id: 600, email: "shared@example.com" },
      "glpat-other": { id: 601, email: "shared@example.com" },
    });

    expect(await signIn("glpat-other", "gitlab")).not.toBe("legacy-owner");
    const [stored] = await storedTokensOf("legacy-owner");
    expect(decrypt(stored.token)).toBe("glpat-owner");
  });

  it("does not hand over a legacy user whose stored token no longer proves the account", async () => {
    await typedDb
      .insert(users)
      .values({ id: "legacy-revoked", name: "Revoked", email: "revoked@example.com" });
    await seedLegacyPat("legacy-revoked", "github", encrypt("ghp-revoked"));
    stubProviders({ "ghp-revoked": 401, "ghp-fresh": { id: 700, email: "revoked@example.com" } });

    expect(await signIn("ghp-fresh", "github")).not.toBe("legacy-revoked");
  });

  it("does not hand over a legacy user whose stored token cannot be decrypted", async () => {
    await typedDb
      .insert(users)
      .values({ id: "legacy-unreadable", name: "Unreadable", email: "unreadable@example.com" });
    await seedLegacyPat("legacy-unreadable", "github", "v1:written-under-another-secret");
    stubProviders({ "ghp-readable": { id: 750, email: "unreadable@example.com" } });

    expect(await signIn("ghp-readable", "github")).not.toBe("legacy-unreadable");
  });

  it("refuses the sign-in instead of creating a user while the stored token cannot be checked", async () => {
    await typedDb
      .insert(users)
      .values({ id: "legacy-outage", name: "Outage", email: "outage@example.com" });
    await seedLegacyPat("legacy-outage", "github", encrypt("ghp-stale"));
    stubProviders({ "ghp-stale": 503, "ghp-current": { id: 800, email: "outage@example.com" } });

    const user = await authorizePat({ token: "ghp-current", provider: "github" }, signInRequest());

    expect(user).toBeNull();
    expect(await usersNamed("user800")).toEqual([]);
  });

  it("keeps the same user id on two GitLab instances apart", async () => {
    stubProviders({
      "glpat-first": { id: 42, email: null },
      "glpat-second": { id: 42, email: null },
    });

    vi.stubEnv("AUTH_GITLAB_URL", "https://gitlab.first.example.com");
    const first = await signIn("glpat-first", "gitlab");
    vi.stubEnv("AUTH_GITLAB_URL", "https://gitlab.second.example.com");
    const second = await signIn("glpat-second", "gitlab");

    expect(second).not.toBe(first);
  });

  it("matches GitLab OAuth links only for gitlab.com accounts", async () => {
    await typedDb
      .insert(users)
      .values({ id: "gitlab-com-user", name: "gitlab.com user", email: "gl@example.com" });
    await typedDb.insert(accounts).values({
      userId: "gitlab-com-user",
      type: "oauth",
      provider: "gitlab",
      providerAccountId: "900",
    });
    stubProviders({
      "glpat-self-hosted": { id: 900, email: null },
      "glpat-dot-com": { id: 900, email: null },
    });

    vi.stubEnv("AUTH_GITLAB_URL", "https://gitlab.example.com");
    expect(await signIn("glpat-self-hosted", "gitlab")).not.toBe("gitlab-com-user");
    vi.stubEnv("AUTH_GITLAB_URL", "https://gitlab.com");
    expect(await signIn("glpat-dot-com", "gitlab")).toBe("gitlab-com-user");
  });

  it("creates new PAT users without an email address", async () => {
    stubProviders({ "ghp-newcomer": { id: 1200, email: "newcomer@example.com" } });

    const user = await authorizePat({ token: "ghp-newcomer", provider: "github" }, signInRequest());

    expect(user?.email).toBeNull();
    expect(await usersNamed("user1200")).toMatchObject([{ email: null }]);
  });

  it("puts the user's stored email in the session, not the provider's", async () => {
    await typedDb
      .insert(users)
      .values({ id: "stored-email", name: "Stored email", email: "primary@corp.example.com" });
    await typedDb.insert(accounts).values({
      userId: "stored-email",
      type: "oauth",
      provider: "github",
      providerAccountId: "1300",
    });
    stubProviders({ "ghp-stored-email": { id: 1300, email: "public@example.com" } });

    const user = await authorizePat(
      { token: "ghp-stored-email", provider: "github" },
      signInRequest()
    );

    expect(user).toMatchObject({ id: "stored-email", email: "primary@corp.example.com" });
  });

  it("signs both overlapping first sign-ins for an account into one new user", async () => {
    stubProviders({ "ghp-race": { id: 1100, email: null } });

    const [first, second] = await Promise.all([
      authorizePat({ token: "ghp-race", provider: "github" }, signInRequest()),
      authorizePat({ token: "ghp-race", provider: "github" }, signInRequest()),
    ]);

    expect(first?.id).toEqual(expect.any(String));
    expect(second?.id).toBe(first?.id);
    expect(await usersNamed("user1100")).toHaveLength(1);
  });

  it("refuses and logs a sign-in whose new user cannot be stored", async () => {
    const takenId = "00000000-0000-4000-8000-000000000001";
    await typedDb.insert(users).values({ id: takenId, name: "Taken id" });
    vi.spyOn(crypto, "randomUUID").mockReturnValue(takenId);
    const logged = vi.spyOn(authLogger, "error");
    stubProviders({ "ghp-unstorable": { id: 1500, email: null } });

    const user = await authorizePat(
      { token: "ghp-unstorable", provider: "github" },
      signInRequest()
    );

    expect(user).toBeNull();
    expect(logged).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "github" }),
      "Failed PAT Auth"
    );
  });
});
