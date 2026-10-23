/**
 * @module tests/e2e/landing
 *
 * Playwright end-to-end test for the public landing page. The hero queue is
 * live, so the test drives it with the same keys the app uses.
 */
import { test, expect } from "@playwright/test";

test("the landing page shows the product and answers the keyboard", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Clear the backlog without touching the mouse"
  );
  await expect(page.getByRole("link", { name: "Sign in to start" })).toBeVisible();

  const rows = page.locator("[data-issue-index]");
  await expect(rows).toHaveCount(7);
  await expect(rows.nth(0)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("j");
  await expect(rows.nth(1)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("1");
  await expect(page.getByRole("status")).toContainText("Set priority to P0");
  await expect(rows.nth(1).getByText("P0", { exact: true })).toBeVisible();

  await page.keyboard.press("z");
  await expect(page.getByRole("status")).toContainText("Undid last action");
  await expect(rows.nth(1).getByText("P0", { exact: true })).toHaveCount(0);
});
