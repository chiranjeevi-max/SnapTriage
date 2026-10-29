import { test, expect } from "@playwright/test";

/**
 * @module tests/e2e/authenticated-inbox
 *
 * Authenticated end-to-end coverage.
 *
 * Runs only when `E2E_GITHUB_PAT` contains a valid GitHub personal access token.
 * Without that secret the test is skipped instead of failing, since CI and local
 * environments cannot sign in to a real provider otherwise.
 */
const githubPat = process.env.E2E_GITHUB_PAT;

test.describe("authenticated inbox", () => {
  test.skip(!githubPat, "requires E2E_GITHUB_PAT");

  test("signs in with a GitHub PAT and uses inbox filters", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/login");
    await page.getByLabel(/personal access token/i).fill(githubPat!);
    await page.getByRole("button", { name: "Continue with token" }).click();

    await page.waitForURL("**/inbox");
    await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();

    const filter = page.getByLabel("Filter issues");
    await expect(filter).toBeVisible();

    await filter.selectOption("urgent");
    await expect(filter).toHaveValue("urgent");

    await filter.selectOption("all");
    await expect(filter).toHaveValue("all");

    const issueCheckbox = page.getByRole("checkbox").first();
    if (await issueCheckbox.isVisible().catch(() => false)) {
      await issueCheckbox.click();
      await expect(page.getByText(/1 selected/)).toBeVisible();
      await page.getByRole("button", { name: "Clear" }).click();
      await expect(page.getByText(/selected/)).not.toBeVisible();
    }

    expect(consoleErrors).toEqual([]);
  });
});
