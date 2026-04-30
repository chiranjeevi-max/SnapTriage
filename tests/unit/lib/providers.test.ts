import { describe, it, expect } from "vitest";
import { getProvider } from "@/lib/providers";
import { githubProvider } from "@/lib/github";
import { gitlabProvider } from "@/lib/gitlab";

describe("getProvider", () => {
  it("should return the github provider for 'github'", () => {
    const provider = getProvider("github");
    expect(provider).toBe(githubProvider);
  });

  it("should return the gitlab provider for 'gitlab'", () => {
    const provider = getProvider("gitlab");
    expect(provider).toBe(gitlabProvider);
  });

  it("should throw an error for unknown providers", () => {
    expect(() => getProvider("unknown")).toThrowError("Unknown provider: unknown");
  });

  it("should throw an error for empty string", () => {
    expect(() => getProvider("")).toThrowError("Unknown provider: ");
  });

  it("should throw an error for undefined", () => {
    expect(() => getProvider(undefined as any)).toThrowError("Unknown provider: undefined");
  });
});
