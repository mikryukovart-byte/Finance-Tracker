import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

const authFile = "e2e/.auth/user.json";
const authCookieNames = ["finance-access-token", "finance-refresh-token"];

async function visiblePageText(page: Page) {
  return (await page.locator("body").innerText())
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join(" | ");
}

async function authFailureDetails(page: Page, testInfo: TestInfo) {
  const screenshotPath = testInfo.outputPath("auth-setup-failure.png");

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);

  return [
    "E2E auth setup failed.",
    `Current URL: ${page.url()}`,
    `Screenshot: ${screenshotPath}`,
    `Visible page text: ${await visiblePageText(page)}`
  ].join("\n");
}

async function waitForAuthenticatedState(page: Page, testInfo: TestInfo) {
  const result = await Promise.race([
    page
      .waitForURL((url) => url.pathname !== "/login", { timeout: 60_000 })
      .then(() => "navigation"),
    page
      .getByTestId("app-shell")
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => "app-shell"),
    page
      .getByTestId("sidebar")
      .waitFor({ state: "visible", timeout: 60_000 })
      .then(() => "sidebar"),
    page
      .waitForFunction(
        async () => {
          const response = await fetch("/api/auth/me").catch(() => null);
          return Boolean(response?.ok);
        },
        undefined,
        { timeout: 60_000 }
      )
      .then(() => "auth-me")
  ]).catch(() => null);

  if (!result) {
    throw new Error(await authFailureDetails(page, testInfo));
  }

  if (new URL(page.url()).pathname === "/login") {
    await page.goto("/");
  }

  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 60_000 });
}

test("authenticate", async ({ page }, testInfo) => {
  const email = process.env.E2E_TEST_EMAIL;
  const password = process.env.E2E_TEST_PASSWORD;

  if (!email || !password) {
    throw new Error(
      "E2E_TEST_EMAIL and E2E_TEST_PASSWORD are required for Playwright auth setup."
    );
  }

  const response = await page.context().request.post("/api/auth/sign-in", {
    data: {
      email,
      password
    }
  });

  if (!response.ok()) {
    const responseBody = await response.text().catch(() => "");
    throw new Error(
      `E2E API login failed with status ${response.status()}. Response: ${responseBody}`
    );
  }

  console.log("[e2e] API login succeeded");

  const cookies = await page.context().cookies();
  const cookieNames = new Set(cookies.map((cookie) => cookie.name));
  const missingCookies = authCookieNames.filter((name) => !cookieNames.has(name));

  if (missingCookies.length > 0) {
    throw new Error(
      `E2E API login did not set expected auth cookies: ${missingCookies.join(", ")}. Received cookies: ${Array.from(cookieNames).join(", ") || "none"}`
    );
  }

  await page.goto("/");
  await waitForAuthenticatedState(page, testInfo);

  mkdirSync(dirname(authFile), { recursive: true });
  await page.context().storageState({ path: authFile });
});
