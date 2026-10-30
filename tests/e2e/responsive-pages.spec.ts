/**
 * @module tests/e2e/responsive-pages
 * Public surfaces retain their actions and stay inside the viewport at narrow
 * widths, including the provider-limit fixtures used by the live demo.
 */
import { test, expect } from "@playwright/test";

test("issue headings scale with the reading pane", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "GitLab", exact: true }).click();
  await expect(page.getByLabel(/personal access token/i)).toHaveAttribute(
    "placeholder",
    "glpat-..."
  );
  // Exercise the shared pane styles without authenticating or mocking a provider.
  await page.evaluate(() => {
    const pane = document.createElement("section");
    pane.className = "issue-detail";
    pane.setAttribute("aria-label", "Reading pane fixture");
    pane.style.width = "640px";
    const heading = document.createElement("h2");
    heading.className = "issue-detail-title";
    heading.textContent = "A long issue title should remain readable in a narrow reading pane";
    pane.append(heading);
    document.querySelector("main")!.append(pane);
  });

  const pane = page.getByRole("region", { name: "Reading pane fixture" });
  const heading = pane.getByRole("heading");
  const fontSize = () =>
    heading.evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  await expect.poll(fontSize).toBeGreaterThan(20);
  const wideSize = await fontSize();

  await pane.evaluate((element) => {
    element.style.width = "371px";
  });
  await expect.poll(fontSize).toBeLessThan(wideSize);
  expect(await heading.evaluate((element) => element.scrollWidth)).toBeLessThanOrEqual(371);
});

test("sign-in heading keeps a consistent scale while resizing", async ({ page }) => {
  await page.goto("/login");
  const heading = page.getByRole("heading", { name: "Sign in", exact: true });
  let initialSize: string | undefined;

  for (const width of [589, 639, 640, 680, 767, 768, 987]) {
    await page.setViewportSize({ width, height: 786 });
    const fontSize = await heading.evaluate((element) => getComputedStyle(element).fontSize);
    initialSize ??= fontSize;
    expect(fontSize, `heading size at ${width}px`).toBe(initialSize);
  }
});

test("sign-in stays balanced when resized across its column breakpoint", async ({ page }) => {
  await page.goto("/login");

  for (const width of [987, 700, 767, 768, 1023, 1024, 1280]) {
    await page.setViewportSize({ width, height: 786 });
    const introduction = page.getByRole("heading", { name: "Sign in", exact: true }).locator("..");
    const providerButton = page.getByRole("button", { name: "Continue with GitHub" });
    const intro = await introduction.boundingBox();
    const provider = await providerButton.boundingBox();
    expect(intro).not.toBeNull();
    expect(provider).not.toBeNull();

    if (width >= 768) {
      expect(provider!.x, `provider column at ${width}px`).toBeGreaterThanOrEqual(
        intro!.x + intro!.width
      );
    } else {
      expect(
        Math.abs(provider!.x + provider!.width / 2 - width / 2),
        `centered stacked form at ${width}px`
      ).toBeLessThanOrEqual(1);
      expect(
        Math.abs(provider!.x - intro!.x),
        `aligned stacked content at ${width}px`
      ).toBeLessThanOrEqual(1);
    }
    expect(provider!.x + provider!.width).toBeLessThanOrEqual(width);
  }
});

for (const width of [320, 390, 1280, 1920]) {
  test(`public pages fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await page.goto("/?data=worst");
    await expect(page.locator("[data-issue-index]")).toHaveCount(7);
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
    await expect(page.getByRole("link", { name: "Sign in to start" })).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          [...document.querySelectorAll("main section > div")].every((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
          })
      )
    ).toBe(true);

    await page.goto("/login");
    await expect(page.getByLabel(/personal access token/i)).toBeVisible();
    const providerLabel = await page.getByText("Token provider", { exact: true }).boundingBox();
    const providerControl = await page.getByRole("group", { name: "Token provider" }).boundingBox();
    expect(providerLabel).not.toBeNull();
    expect(providerControl).not.toBeNull();
    expect(providerControl!.y - (providerLabel!.y + providerLabel!.height)).toBeGreaterThanOrEqual(
      8
    );
    await page.getByRole("button", { name: "GitLab", exact: true }).click();
    await expect(page.getByLabel(/personal access token/i)).toHaveAttribute(
      "placeholder",
      "glpat-..."
    );
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= window.innerWidth &&
          [...document.querySelectorAll("main section > div")].every((element) => {
            const bounds = element.getBoundingClientRect();
            return bounds.left >= 0 && bounds.right <= window.innerWidth + 1;
          })
      )
    ).toBe(true);
  });
}
