/**
 * @module middleware
 * Next.js middleware entry point. Re-exports the auth proxy from {@link proxy}
 * to enable route protection across the entire application.
 *
 * Without this file, Next.js never invokes the auth proxy, leaving all
 * protected routes (/inbox, /settings, /repos) accessible without authentication.
 */
export { proxy as default } from "./proxy";
export { config } from "./proxy";
