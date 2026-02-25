/**
 * @module auth.config
 *
 * Edge-safe Auth.js configuration (no Node.js-only imports).
 *
 * This config is shared between the full NextAuth setup ({@link auth.ts}) and
 * the Edge middleware/proxy. It defines:
 * - OAuth providers (GitHub, GitLab)
 * - JWT session strategy (required for Credentials provider compatibility)
 * - Custom sign-in page redirect
 * - JWT/session callbacks that attach `user.id` to the token and session
 */
import GitHub from "next-auth/providers/github";
import GitLab from "next-auth/providers/gitlab";
import type { NextAuthConfig } from "next-auth";

/**
 * Auth.js config that is safe for Edge Runtime (no Node.js imports).
 * Used by middleware/proxy. The full config with DB adapter is in auth.ts.
 */
export const authConfig = {
  providers: [
    GitHub,
    GitLab({
      clientId: process.env.AUTH_GITLAB_ID,
      clientSecret: process.env.AUTH_GITLAB_SECRET,
    }),
  ],
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
