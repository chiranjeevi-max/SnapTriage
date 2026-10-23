/**
 * @module tests/unit/features/auth/login-form
 *
 * Unit tests for the sign-in form.
 *
 * Covers the two sign-in paths, the provider toggle, the disabled state of the
 * token button, and what happens when the server rejects or accepts a token.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/* @vitest-environment jsdom */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { LoginForm } from "@/features/auth/components/login-form";

const { signInMock } = vi.hoisted(() => ({ signInMock: vi.fn() }));

vi.mock("next-auth/react", () => ({
  signIn: signInMock,
}));

describe("LoginForm", () => {
  beforeEach(() => {
    signInMock.mockReset();
    signInMock.mockResolvedValue(undefined);
    global.fetch = vi.fn();
  });

  it("offers both provider sign-in paths", () => {
    render(<LoginForm />);

    expect(screen.getByRole("button", { name: /continue with github/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /continue with gitlab/i })).toBeDefined();
    expect(screen.getByLabelText(/personal access token/i)).toBeDefined();
  });

  it("keeps the token button disabled until a token is entered", () => {
    render(<LoginForm />);

    const submit = screen.getByRole("button", { name: /continue with token/i });
    expect(submit.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText(/personal access token/i), {
      target: { value: "ghp_example" },
    });

    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("switches the scope hint when the provider changes", () => {
    render(<LoginForm />);

    expect(screen.getByText(/needs the repo scope/i)).toBeDefined();

    const provider = within(screen.getByRole("group", { name: /token provider/i }));
    fireEvent.click(provider.getByRole("button", { name: "GitLab" }));

    expect(screen.getByText(/needs the api scope/i)).toBeDefined();
    expect(screen.getByLabelText(/personal access token/i).getAttribute("placeholder")).toBe(
      "glpat-..."
    );
  });

  it("shows the server error when a token is rejected", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Invalid token" }),
    } as Response);

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText(/personal access token/i), {
      target: { value: "ghp_wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue with token/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Invalid token");
    });

    expect(signInMock).not.toHaveBeenCalled();
  });

  it("signs in with the credentials provider once the token is accepted", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ valid: true, user: { id: "1" } }),
    } as Response);

    render(<LoginForm />);

    fireEvent.change(screen.getByLabelText(/personal access token/i), {
      target: { value: "ghp_valid" },
    });
    fireEvent.click(screen.getByRole("button", { name: /continue with token/i }));

    await waitFor(() => {
      expect(signInMock).toHaveBeenCalledWith("credentials", {
        token: "ghp_valid",
        provider: "github",
        redirectTo: "/inbox",
      });
    });
  });
});
