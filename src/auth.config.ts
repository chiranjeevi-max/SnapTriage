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
