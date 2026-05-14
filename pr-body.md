🎯 **What:** Replaced the explicit `any` type in the NextAuth `DrizzleAdapter` `linkAccount(account: any)` method with the robust `Account` type from `next-auth`. Reassigned properties explicitly using `@ts-expect-error` to satisfy type constraints since we are modifying read-only `access_token` and `refresh_token` properties to encrypt them.

Additionally, corrected a type capitalization issue with Drizzle ORM (`inferSelectModel` to `InferSelectModel`) in `src/features/sync/sync-engine.ts`.

💡 **Why:** Using `any` bypasses TypeScript's type checking, which can lead to runtime errors and reduces code maintainability and readability. By strictly typing the parameter to `Account` and explicitly casting to `any` only at the required interface boundary with `nativeAdapter.linkAccount`, the method remains strongly typed internally. Fixing the Drizzle ORM typing prevents future build/typing errors since `inferSelectModel` is deprecated.

✅ **Verification:** Verified by:
- Running `npm run build` to confirm no new type checking errors were introduced.
- Running `npm run test` to verify all unit tests continue to pass.
- Running `npm run format:check` and `npm run lint` to ensure code style conventions are upheld.

✨ **Result:** Better IDE autocomplete, stronger type safety when refactoring, a clean build process, and reduced reliance on explicit `any`.
