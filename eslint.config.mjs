/** ESLint flat config -- extends Next.js core-web-vitals + TypeScript rules with Prettier. */
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    // TanStack Virtual returns helpers React Compiler cannot memoize, so the
    // compiler skips IssueList. The warning has no code-level fix short of
    // dropping the virtualizer; scope the rule to the one component that uses it.
    files: ["src/features/inbox/components/issue-list.tsx"],
    rules: {
      "react-hooks/incompatible-library": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
