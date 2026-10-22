/**
 * @module auth/pat-provider
 *
 * Defines the NextAuth Credentials provider for Personal Access Tokens.
 * This provider intercepts the sign-in request, enforces rate limits, validates
 * the token against the respective provider (GitHub/GitLab), and handles user
 * and token upsertion into the database.
 */
import Credentials from "next-auth/providers/credentials";
import { validateToken, type TokenProvider } from "@/features/auth/validate-token";
import {
  findUserByEmail,
  createUser,
  updateUser,
  storeAccessToken,
} from "@/features/auth/user-repository";
import { authLogger } from "@/lib/logger";
import { checkPersistentRateLimit } from "@/lib/rate-limit";
import { clientIp, rateLimitKey } from "@/lib/request-context";

export const patProvider = Credentials({
  id: "credentials",
  name: "Personal Access Token",
  credentials: {
    token: { label: "Token", type: "password" },
    provider: { label: "Provider", type: "text" },
  },
  async authorize(credentials, request) {
    const provider = credentials?.provider as TokenProvider | undefined;
    const ip = clientIp(request);

    // Scoped separately from the /api/auth/token validation step it follows, so
    // the two halves of one sign-in do not spend the same allowance.
    if (await checkPersistentRateLimit(rateLimitKey(request, "pat:signin"), 5)) {
      authLogger.warn(
        { ip: ip ?? "unattributed", provider: provider ?? "unknown" },
        "Rate limit exceeded for PAT authentication"
      );
      throw new Error("Too Many Requests. Please try again later.");
    }

    if (
      !credentials?.token ||
      typeof credentials.token !== "string" ||
      credentials.token.length > 255 ||
      !credentials.token.trim()
    ) {
      return null;
    }

    const token = credentials.token.trim();

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
});
