import { expect, type Page, test } from "@playwright/test";

const appPages = [
  { path: "/", title: "Главная" },
  { path: "/truth", title: "Правда" },
  { path: "/accounts", title: "Счета" },
  { path: "/operations", title: "Операции" },
  { path: "/categories", title: "Категории" },
  { path: "/loans", title: "Кредиты" },
  { path: "/reports", title: "Отчеты" },
  { path: "/advisor", title: "Советник" },
  { path: "/goals", title: "Годовые цели" },
  { path: "/settings", title: "Настройки" }
];

const fatalErrorPattern =
  /Application error|Unhandled Runtime Error|ChunkLoadError|TypeError|ReferenceError|Internal Server Error|Ошибка сервера|Не удалось загрузить|Не удалось получить|Failed to fetch/i;

async function expectNoLoginRedirect(page: Page) {
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
}

async function expectNoFatalError(page: Page) {
  await expect(page.locator("body")).not.toContainText(fatalErrorPattern);
}

async function expectAuthenticatedApp(page: Page) {
  await expectNoLoginRedirect(page);
  await expect(page.getByTestId("app-shell")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("sidebar")).toBeVisible({ timeout: 30_000 });
}

async function openAppPage(page: Page, path: string, title: string) {
  await page.goto(path);
  await expectAuthenticatedApp(page);
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expectNoFatalError(page);
}

test.describe("smoke", () => {
  test.beforeEach(async ({ page }) => {
    await openAppPage(page, "/", "Главная");
  });

  test("opens all main sections", async ({ page }) => {
    for (const route of appPages) {
      await openAppPage(page, route.path, route.title);
    }
  });

  test("keeps auth session stable while navigating repeatedly", async ({ page }) => {
    for (let round = 0; round < 2; round += 1) {
      for (const route of appPages) {
        await openAppPage(page, route.path, route.title);
      }
    }
  });

  test("updates annual goal start date without timezone shift", async ({ page }) => {
    await openAppPage(page, "/goals", "Годовые цели");

    const settingsForm = page.locator("form").filter({ hasText: "Настройки плана" });

    await settingsForm.getByRole("button", { name: "Ввести вручную" }).click();
    await settingsForm.getByLabel("Дата старта плана").fill("2026-07-01");
    await settingsForm.getByLabel("Значение точки А").fill("75000");
    await settingsForm.getByLabel("Цель C1 к B10").fill("150000");
    await settingsForm.getByLabel("Цель C2 к B10").fill("200000");
    await settingsForm.getByLabel("Цель C3 к B10").fill("250000");

    const saveButton = settingsForm.getByRole("button", { name: /Сохранить|Сохраняем/ });
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/goals") &&
        response.request().method() !== "GET",
      { timeout: 30_000 }
    );

    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();
    await expect(saveButton).toBeEnabled();
    await expect(settingsForm.getByLabel("Дата старта плана")).toHaveValue("2026-07-01");
    await expect(page.getByText("Июль 2026").first()).toBeVisible();
    await expect(page.getByText("Август 2026").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("30.06.2026");
    await expectAuthenticatedApp(page);
    await expectNoFatalError(page);
  });
});
