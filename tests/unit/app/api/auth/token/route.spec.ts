/**
 * @module tests/unit/app/api/auth/token/route.spec.ts
 * Unit tests for the PAT validation API route.
 */
import { describe, it, expect, vi } from "vitest";
import { POST } from "@/app/api/auth/token/route";
import { validateToken } from "@/features/auth/validate-token";

vi.mock("@/features/auth/validate-token", () => ({
  validateToken: vi.fn(),
}));

describe("POST /api/auth/token", () => {
  it("should return 200 and user data on successful validation", async () => {
    const mockUser = { id: "1", name: "Test User", email: "test@example.com", image: "https://avatar.url" };
    vi.mocked(validateToken).mockResolvedValueOnce(mockUser);

    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ token: "valid-gh-token", provider: "github" }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toEqual({ valid: true, user: mockUser });
    expect(validateToken).toHaveBeenCalledWith("valid-gh-token", "github");
  });

  it("should return 400 if token is missing", async () => {
    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ provider: "github" }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Token and provider are required");
  });

  it("should return 400 if provider is invalid", async () => {
    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ token: "token", provider: "bitbucket" }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid provider");
  });

  it("should return 401 if validateToken fails", async () => {
    vi.mocked(validateToken).mockRejectedValueOnce(new Error("Unauthorized"));

    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: JSON.stringify({ token: "invalid-token", provider: "gitlab" }),
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Invalid token");
  });

  it("should return 401 if request body parsing fails", async () => {
    const req = new Request("http://localhost/api/auth/token", {
      method: "POST",
      body: "not-a-json",
    });

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Invalid token");
  });

  it("should return 401 when encountering an unexpected error in the route handler", async () => {
    // This empty object missing the json() method simulates an internal error
    // within the POST handler, triggering the catch block.
    const req = {} as Request;

    const response = await POST(req);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Invalid token");
  });
});
