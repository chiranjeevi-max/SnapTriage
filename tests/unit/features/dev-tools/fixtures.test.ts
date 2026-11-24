/**
 * @module tests/unit/features/dev-tools/fixtures
 *
 * Fixture rows have to open the page they claim to come from.
 */
import { describe, expect, it } from "vitest";
import { manyIssues } from "@/features/dev-tools/fixtures";

describe("manyIssues URLs", () => {
  it("derives the issue URL from the row's provider, repository, and number", () => {
    const issues = manyIssues(40);
    const gitlab = issues.find((issue) => issue.provider === "gitlab");
    const github = issues.find((issue) => issue.provider === "github");

    expect(gitlab?.url).toMatch(/^https:\/\/gitlab\.com\/.+\/-\/issues\/\d+$/);
    expect(gitlab?.url.endsWith(`/-/issues/${gitlab?.number}`)).toBe(true);
    expect(github?.url).toMatch(/^https:\/\/github\.com\/.+\/issues\/\d+$/);
    expect(github?.url.endsWith(`/issues/${github?.number}`)).toBe(true);
  });
});
