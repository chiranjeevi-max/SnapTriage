/**
 * @module tests/unit/features/repos/repo-label
 *
 * Repository names are machine data and can be longer than either pane. The
 * queue and the reading pane share these helpers so both truncate the same way.
 */
import { describe, expect, it } from "vitest";
import { repoNameMap, shortenRepoName } from "@/features/repos/repo-label";

describe("shortenRepoName", () => {
  it("leaves a name that already fits untouched", () => {
    expect(shortenRepoName("acme/console", 40)).toBe("acme/console");
  });

  it("keeps the group and repository ends of a long GitLab path", () => {
    const full = "group/subgroup/second-subgroup/project-with-a-very-long-name";
    const short = shortenRepoName(full, 40);

    expect(short.length).toBeLessThanOrEqual(40);
    expect(short.startsWith("group/")).toBe(true);
    expect(short.endsWith("name")).toBe(true);
    expect(short).toContain("…");
  });

  it("keeps the repository suffix that distinguishes similar repos", () => {
    const short = shortenRepoName("owner/repository-with-suffix-v2", 20);

    expect(short.length).toBeLessThanOrEqual(20);
    expect(short.endsWith("v2")).toBe(true);
  });

  it("stays within the requested maximum for every size above the guard", () => {
    const full = "a-very-long-organization/repository-with-a-very-long-name";

    for (const max of [4, 5, 8, 12, 20, 40]) {
      expect(shortenRepoName(full, max).length).toBeLessThanOrEqual(max);
    }
  });

  it("truncates a name with no slash from the end", () => {
    expect(shortenRepoName("a".repeat(40), 10)).toBe(`${"a".repeat(9)}…`);
  });

  it("never returns an empty repository half", () => {
    const short = shortenRepoName("owner/repository-name-that-is-too-long", 12);
    expect(short).toContain("/");
    expect(short.split("/")[1].length).toBeGreaterThan(0);
  });
});

describe("repoNameMap", () => {
  it("keys names by repository id", () => {
    const map = repoNameMap([
      { id: "r1", fullName: "acme/console" },
      { id: "r2", fullName: "acme/api" },
    ]);

    expect(map.get("r1")).toBe("acme/console");
    expect(map.get("r2")).toBe("acme/api");
    expect(map.size).toBe(2);
  });
});
