import { describe, it, expect } from "vitest";
import {
  triagePatchSchema,
  connectRepoSchema,
  syncTriggerSchema,
  tokenValidationSchema,
  parseBody,
} from "@/lib/validations";
import { z } from "zod";

describe("Validations", () => {
  describe("triagePatchSchema", () => {
    it("should allow a valid full payload", () => {
      const payload = {
        priority: 1,
        snoozedUntil: new Date().toISOString(),
        dismissed: true,
        labels: { add: ["bug"], remove: ["enhancement"] },
        assignees: { add: ["user1"], remove: ["user2"] },
        state: "closed",
        batch: false,
      };
      const result = triagePatchSchema.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it("should allow an empty payload", () => {
      const result = triagePatchSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("should reject priority outside 0-3", () => {
      const result = triagePatchSchema.safeParse({ priority: 4 });
      expect(result.success).toBe(false);
      const result2 = triagePatchSchema.safeParse({ priority: -1 });
      expect(result2.success).toBe(false);
    });

    it("should reject invalid snooze dates", () => {
      const result = triagePatchSchema.safeParse({ snoozedUntil: "not-a-date" });
      expect(result.success).toBe(false);
    });

    it("should enforce limits on labels arrays", () => {
      const longString = "a".repeat(257);
      const result = triagePatchSchema.safeParse({ labels: { add: [longString] } });
      expect(result.success).toBe(false);

      const tooManyLabels = new Array(101).fill("label");
      const result2 = triagePatchSchema.safeParse({ labels: { add: tooManyLabels } });
      expect(result2.success).toBe(false);
    });
  });

  describe("connectRepoSchema", () => {
    it("should allow valid github repo", () => {
      const payload = {
        provider: "github",
        owner: "test-owner",
        name: "test-repo",
        fullName: "test-owner/test-repo",
      };
      const result = connectRepoSchema.safeParse(payload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.permission).toBe("read"); // default
      }
    });

    it("should enforce min lengths", () => {
      const payload = {
        provider: "github",
        owner: "",
        name: "test-repo",
        fullName: "test-owner/test-repo",
      };
      const result = connectRepoSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });

    it("should reject invalid provider", () => {
      const payload = {
        provider: "bitbucket",
        owner: "test",
        name: "test",
        fullName: "test/test",
      };
      const result = connectRepoSchema.safeParse(payload);
      expect(result.success).toBe(false);
    });
  });

  describe("syncTriggerSchema", () => {
    it("should allow valid uuid", () => {
      const result = syncTriggerSchema.safeParse({
        repoId: "123e4567-e89b-12d3-a456-426614174000",
      });
      expect(result.success).toBe(true);
    });

    it("should reject invalid uuid", () => {
      const result = syncTriggerSchema.safeParse({ repoId: "not-a-uuid" });
      expect(result.success).toBe(false);
    });

    it("should allow empty payload", () => {
      const result = syncTriggerSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  describe("tokenValidationSchema", () => {
    it("should allow valid token and provider", () => {
      const result = tokenValidationSchema.safeParse({
        token: "ghp_1234567890",
        provider: "github",
      });
      expect(result.success).toBe(true);
    });

    it("should reject empty token", () => {
      const result = tokenValidationSchema.safeParse({
        token: "",
        provider: "github",
      });
      expect(result.success).toBe(false);
    });
  });

  describe("parseBody", () => {
    const testSchema = z.object({
      name: z.string(),
      age: z.number().min(18),
    });

    it("should return success and data for valid input", () => {
      const result = parseBody(testSchema, { name: "John", age: 25 });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual({ name: "John", age: 25 });
      }
    });

    it("should return false and error string for invalid input", () => {
      const result = parseBody(testSchema, { name: "John", age: 10 });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain("age:");
      }
    });
  });
});
