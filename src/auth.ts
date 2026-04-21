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
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { validateToken, type TokenProvider } from "@/features/auth/validate-token";
import { encrypt } from "@/lib/crypto";
import {
  findUserByEmail,
  createUser,
  updateUser,
  storeAccessToken,
} from "@/features/auth/user-repository";
import { authLogger } from "@/lib/logger";
import { authConfig } from "./auth.config";

// In-memory rate limiting map for basic protection against brute-force
const rateLimitMap = new Map<string, { count: number; timestamp: number }>();

// Cast `db` to any because DrizzleAdapter's type expects a specific Drizzle flavor
// but our `db` is a union of SQLite | Neon clients.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const nativeAdapter = DrizzleAdapter(db as any, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

// Wrap native DrizzleAdapter to ensure standard OAuth tokens are encrypted at rest
const adapter = {
  ...nativeAdapter,
  async linkAccount(account: any) {
    if (account.access_token) {
      account.access_token = encrypt(account.access_token);
    }
    if (account.refresh_token) {
      account.refresh_token = encrypt(account.refresh_token);
    }
    return nativeAdapter.linkAccount!(account);
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter: adapter as any,
  providers: [
    ...authConfig.providers,
    Credentials({
      id: "credentials",
      name: "Personal Access Token",
      credentials: {
        token: { label: "Token", type: "password" },
        provider: { label: "Provider", type: "text" },
      },
      async authorize(credentials, request) {
        // Rate Limiting Logic
        const ip = request.headers?.get("x-forwarded-for") || "unknown";
        const now = Date.now();
        const windowMs = 15 * 60 * 1000; // 15 minutes window

        // Clean up old entries
        for (const [key, value] of rateLimitMap.entries()) {
          if (now - value.timestamp > windowMs) rateLimitMap.delete(key);
        }

        const record = rateLimitMap.get(ip) || { count: 0, timestamp: now };
        record.count++;

        if (record.count > 5) {
          authLogger.warn({ip}, "Rate limit exceeded for PAT authentication");
          throw new Error("Too Many Requests. Please try again later.");
        }

        rateLimitMap.set(ip, record);

        if (
          !credentials?.token ||
          typeof credentials.token !== "string" ||
          credentials.token.length > 255 ||
          !credentials.token.trim()
        ) {
          return null;
        }

        const token = credentials.token.trim();
        const provider = credentials.provider as TokenProvider;

        if (provider !== "github" && provider !== "gitlab") {
          return null;
        }

        try {
          const validatedUser = await validateToken(token, provider);

          // Upsert user in database
          const existingUser = await findUserByEmail(validatedUser.email ?? "");

          let userId: string;

          if (existingUser) {
            userId = existingUser.id;
            await updateUser(userId, {
              name: validatedUser.name,
              image: validatedUser.image,
            });
          } else {
            userId = crypto.randomUUID();
            await createUser({
              id: userId,
              name: validatedUser.name,
              email: validatedUser.email,
              image: validatedUser.image,
            });
          }

          // Store the PAT
          await storeAccessToken({
            userId,
            provider,
            token,
            label: `${provider}-pat`,
          });

          return {
            id: userId,
            name: validatedUser.name,
            email: validatedUser.email,
            image: validatedUser.image,
          };
        } catch (error) {
          const errMessage = error instanceof Error ? error.message : "Unknown error";
          authLogger.error({ provider, error: errMessage }, "Failed PAT Auth");
          return null;
        }
      },
    }),
  ],
});
