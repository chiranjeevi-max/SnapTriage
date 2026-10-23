/**
 * @module tests/e2e/public-pages
 *
 * Playwright end-to-end tests for the pages a signed-out visitor can reach:
 * the sign-in page, the gate that protects the app, and the not-found page.
 */
import { test, expect } from "@playwright/test";

test("the landing page leads to the sign-in page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in to start" }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("the sign-in page offers both provider paths", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("button", { name: /continue with github/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /continue with gitlab/i })).toBeVisible();
  await expect(page.getByLabel(/personal access token/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /continue with token/i })).toBeDisabled();
});

test("the token button unlocks once a token is typed", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel(/personal access token/i).fill("ghp_example");

  await expect(page.getByRole("button", { name: /continue with token/i })).toBeEnabled();
});

test("protected routes send signed-out visitors to the sign-in page", async ({ page }) => {
  await page.goto("/inbox");

  await expect(page).toHaveURL(/\/login/);
});

test("an unknown URL shows the not-found page", async ({ page }) => {
  const response = await page.goto("/does-not-exist");

  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: /this page does not exist/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /go to the inbox/i })).toBeVisible();
});
