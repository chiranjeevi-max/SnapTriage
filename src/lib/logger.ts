/**
 * @module lib/logger
 *
 * Structured logging with Pino for server-side operations.
 * Provides child loggers for key subsystems (sync, auth, api, provider).
 *
 * - **Development:** Pretty-printed, colorized output at `debug` level.
 * - **Production:** JSON output at `info` level for log aggregation.
 */
import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

/** Root logger instance. */
export const logger = pino({
  level: isDev ? "debug" : "info",
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      }
    : undefined,
});

/** Logger for sync engine operations. */
export const syncLogger = logger.child({ module: "sync" });

/** Logger for authentication flows. */
export const authLogger = logger.child({ module: "auth" });

/** Logger for API route handlers. */
export const apiLogger = logger.child({ module: "api" });

/** Logger for provider API interactions (GitHub/GitLab). */
export const providerLogger = logger.child({ module: "provider" });
