/**
 * @module auth
 *
 * Main Auth.js (NextAuth v5) configuration with database adapter and providers.
 *
 * Combines the edge-safe config from {@link auth.config} with:
 * - A Drizzle ORM adapter backed by the app's SQLite/Postgres database
 * - A Credentials provider for Personal Access Token (PAT) sign-in
 *
 * PAT flow: validate token against GitHub/GitLab API, upsert user in DB,
 * store the PAT in the `accessTokens` table, and return a session.
 *
 * Exports `handlers` (route handler), `auth` (session getter), `signIn`, `signOut`.
 */
import NextAuth, { type Account } from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { encrypt } from "@/lib/crypto";
import { authConfig } from "./auth.config";
import { patProvider } from "@/features/auth/pat-provider";

// DrizzleAdapter expects one driver, but our `db` is SQLite/Neon; cast it.
const nativeAdapter = DrizzleAdapter(db as unknown as Parameters<typeof DrizzleAdapter>[0], {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

// Wrap native DrizzleAdapter to ensure standard OAuth tokens are encrypted at rest
const adapter = {
  ...nativeAdapter,
  async linkAccount(account: Account) {
    if (account.access_token) {
      // @ts-expect-error NextAuth Account types mark access_token as readonly, but we need to encrypt it
      account.access_token = encrypt(account.access_token);
    }
    if (account.refresh_token) {
      // @ts-expect-error NextAuth Account types mark refresh_token as readonly, but we need to encrypt it
      account.refresh_token = encrypt(account.refresh_token);
    }
    return nativeAdapter.linkAccount!(account as never);
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: adapter as never,
  providers: [...authConfig.providers, patProvider],
});
