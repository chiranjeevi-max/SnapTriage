/**
 * @module tests/e2e/home
 *
 * Playwright end-to-end smoke test verifying that the homepage loads
 * and renders the expected page title.
 */
import { test, expect } from "@playwright/test";

test("homepage loads", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/SnapTriage/i);
});
