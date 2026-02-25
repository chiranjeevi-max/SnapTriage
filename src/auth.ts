import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "@/lib/db";
import { accounts, sessions, users, verificationTokens } from "@/lib/db/schema";
import { validateToken, type TokenProvider } from "@/features/auth/validate-token";
import {
  findUserByEmail,
  createUser,
  updateUser,
  storeAccessToken,
} from "@/features/auth/user-repository";
import { authConfig } from "./auth.config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const adapter = DrizzleAdapter(db as any, {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  adapter,
  providers: [
    ...authConfig.providers,
    Credentials({
      id: "credentials",
      name: "Personal Access Token",
      credentials: {
        token: { label: "Token", type: "password" },
        provider: { label: "Provider", type: "text" },
      },
      async authorize(credentials) {
        const token = credentials.token as string;
        const provider = credentials.provider as TokenProvider;

        if (!token || !provider) return null;

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
        } catch {
          return null;
        }
      },
    }),
  ],
});
