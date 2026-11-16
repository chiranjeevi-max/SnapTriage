/** Vitest configuration for unit tests (tests/unit/) with React plugin and @/ path alias. */
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/unit/**/*.{test,spec}.{ts,tsx}"],
    globals: true,
    // React selects its development or production build from NODE_ENV when a
    // module is first required, and only the development build exports `act`.
    // A shell that exports NODE_ENV=production therefore breaks every jsdom
    // test with "React.act is not a function". Pin it here so `npm test`
    // behaves the same whatever the caller's environment holds.
    env: { NODE_ENV: "test" },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
