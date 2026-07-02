import { expect, type Page, test } from "@playwright/test";

const appPages = [
  { path: "/", title: "Главная" },
  { path: "/operations", title: "Операции" },
  { path: "/wallet", title: "Кошелёк" },
  { path: "/strategy", title: "Стратегия" },
  { path: "/strategy/goals", title: "Цели" },
  { path: "/strategy/year", title: "План года" },
  { path: "/strategy/three-year", title: "План 3-2-1" },
  { path: "/strategy/actions", title: "Неделя" },
  { path: "/strategy/notes", title: "Рабочие записи" },
  { path: "/strategy/actions/history", title: "Дневник действий" },
  { path: "/analytics", title: "Аналитика" },
  { path: "/advisor", title: "Советник" },
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

function toDateInputValue(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function monthYearLabel(date: Date) {
  const label = new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric"
  })
    .format(date)
    .replace(/\s*г\.$/, "");

  return `${label.charAt(0).toLocaleUpperCase("ru-RU")}${label.slice(1)}`;
}

function russianDateLabel(date: Date) {
  return [
    String(date.getDate()).padStart(2, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    date.getFullYear()
  ].join(".");
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

  test("switches wallet sections", async ({ page }) => {
    await openAppPage(page, "/wallet", "Кошелёк");

    await page.getByRole("button", { name: /Кредиты/ }).first().click();
    await expect(page.getByRole("heading", { name: "Кредиты", level: 1 })).toBeVisible();
    await expectNoFatalError(page);

    await page.getByRole("button", { name: /Счета/ }).first().click();
    await expect(page.getByRole("heading", { name: "Счета", level: 1 })).toBeVisible();
    await expectNoFatalError(page);
  });

  test("toggles long list blocks", async ({ page }) => {
    await openAppPage(page, "/", "Главная");
    const dashboardOperationsToggle = page
      .getByRole("button", { name: /Показать операции|Скрыть операции/ })
      .first();
    await expect(dashboardOperationsToggle).toBeVisible();
    await dashboardOperationsToggle.click();
    await expect(
      page.getByRole("button", { name: /Показать операции|Скрыть операции/ }).first()
    ).toBeVisible();

    await openAppPage(page, "/strategy/actions", "Неделя");
    const hypothesesToggle = page.getByRole("button", {
      name: /Показать гипотезы|Скрыть гипотезы/
    });
    await expect(hypothesesToggle).toBeVisible();
    await hypothesesToggle.click();
    await expect(
      page.getByRole("button", { name: /Показать гипотезы|Скрыть гипотезы/ })
    ).toBeVisible();

    const actionsToggle = page.getByRole("button", {
      name: /Показать действия|Скрыть действия/
    });
    await expect(actionsToggle).toBeVisible();
    await actionsToggle.click();
    await expect(
      page.getByRole("button", { name: /Показать действия|Скрыть действия/ })
    ).toBeVisible();
    await expectNoFatalError(page);
  });

  test("keeps one shared week across takt, hypotheses and actions", async ({ page }) => {
    await openAppPage(page, "/strategy/actions", "Неделя");

    const selector = page.getByTestId("shared-week-selector");
    const weeklyTakt = page.getByTestId("weekly-takt");
    const hypotheses = page.getByTestId("weekly-hypotheses");
    const actions = page.getByTestId("daily-actions");
    const currentWeek = await selector.getAttribute("data-week-start");

    expect(currentWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("button", { name: "Предыдущая", exact: true })).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Следующая", exact: true })).toHaveCount(1);

    const previousWeekDate = new Date(`${currentWeek}T12:00:00`);
    previousWeekDate.setDate(previousWeekDate.getDate() - 7);
    const previousWeek = toDateInputValue(previousWeekDate);

    await page.getByRole("button", { name: "Предыдущая", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`week=${previousWeek}`));
    await expect(selector).toHaveAttribute("data-week-start", previousWeek);
    await expect(weeklyTakt).toHaveAttribute("data-week-start", previousWeek);
    await expect(hypotheses).toHaveAttribute("data-week-start", previousWeek);
    await expect(actions).toHaveAttribute("data-week-start", previousWeek);
    await expectNoFatalError(page);
  });

  test("creates, edits and deletes a weekly hypothesis", async ({ page }) => {
    await openAppPage(page, "/strategy/actions", "Неделя");

    const marker = `E2E hypothesis ${Date.now()}`;
    const updatedMarker = `${marker} updated`;
    const section = page.getByTestId("weekly-hypotheses");

    await section.getByRole("button", { name: "Добавить гипотезу" }).click();
    await section.getByLabel("Новая гипотеза").fill(marker);
    await section.getByLabel("Что делаю в новой гипотезе").fill("Пишу десяти клиентам");
    await section
      .getByLabel("Ожидаемый результат новой гипотезы")
      .fill("Два ответа");
    await section.locator("form").getByRole("button", { name: "Добавить", exact: true }).click();

    let card = section.getByTestId("weekly-hypothesis-card").filter({ hasText: marker });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Редактировать" }).click();
    await card.getByLabel("Гипотеза").fill(updatedMarker);
    await card.getByRole("button", { name: "Сохранить" }).click();

    card = section.getByTestId("weekly-hypothesis-card").filter({ hasText: updatedMarker });
    await expect(card).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Удалить" }).click();
    await expect(card).toHaveCount(0);
  });

  test("creates, edits and soft-deletes a Daily Action from compact rows", async ({ page }) => {
    await openAppPage(page, "/strategy/actions", "Неделя");

    const marker = `E2E compact action ${Date.now()}`;
    const updatedMarker = `${marker} updated`;
    const section = page.getByTestId("daily-actions");

    await section.getByRole("button", { name: "Добавить вручную" }).click();
    const createForm = section.locator("form");
    await createForm.getByLabel("Тип").selectOption("FOLLOW_UP");
    await createForm.getByLabel("Кому / куда").fill(marker);
    await createForm.getByLabel("Почему это было ценно").fill("Вернул контакт в работу");
    await createForm.getByLabel("Следующий шаг").fill("Написать через два дня");
    await createForm.getByRole("button", { name: "Добавить", exact: true }).click();

    let card = section.getByTestId("daily-action-card").filter({ hasText: marker });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Подробнее" }).click();
    await card.getByLabel("Кому / куда").fill(updatedMarker);
    await card.getByRole("button", { name: "Сохранить" }).click();

    card = section.getByTestId("daily-action-card").filter({ hasText: updatedMarker });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Подробнее" }).click();
    page.once("dialog", (dialog) => dialog.accept());
    await card.getByRole("button", { name: "Удалить" }).click();
    await expect(card).toHaveCount(0);

    await section.getByRole("link", { name: "Открыть полный дневник" }).click();
    await expect(page).toHaveURL(/\/strategy\/actions\/history$/);
    await expect(page.getByRole("heading", { name: "Дневник действий", level: 1 })).toBeVisible();
  });

  test("shows the Dashboard weekly actions snapshot", async ({ page }) => {
    await openAppPage(page, "/", "Главная");

    const snapshot = page.getByTestId("dashboard-weekly-actions");
    await expect(snapshot.getByRole("heading", { name: "Действия недели" })).toBeVisible();
    await expect(snapshot.getByText("Первые касания", { exact: true })).toBeVisible();
    await expect(snapshot.getByText("Всего действий", { exact: true })).toBeVisible();
    await snapshot.getByRole("link", { name: "Открыть неделю →" }).click();
    await expect(page).toHaveURL(/\/strategy\/actions\?week=\d{4}-\d{2}-\d{2}$/);
    await expect(page.getByRole("heading", { name: "Неделя", level: 1 })).toBeVisible();
  });

  test("updates annual goal start date without timezone shift", async ({ page }) => {
    test.setTimeout(60_000);
    await openAppPage(page, "/strategy/goals", "Цели");

    const now = new Date();
    const planStartDate = new Date(now.getFullYear(), now.getMonth() + 1, 1, 12);
    const followingMonth = new Date(
      planStartDate.getFullYear(),
      planStartDate.getMonth() + 1,
      1,
      12
    );
    const dayBeforePlanStart = new Date(
      planStartDate.getFullYear(),
      planStartDate.getMonth(),
      0,
      12
    );
    const planStartInput = toDateInputValue(planStartDate);

    const settingsForm = page.locator("form").filter({ hasText: "Настройки плана" });

    await settingsForm.getByRole("button", { name: "Ввести вручную" }).click();
    await settingsForm.getByLabel("Дата старта плана").fill(planStartInput);
    await settingsForm.getByLabel("Значение точки А").fill("75000");
    await settingsForm.getByLabel("Цель C1 к B10").fill("150000");
    await settingsForm.getByLabel("Цель C2 к B10").fill("200000");
    await settingsForm.getByLabel("Цель C3 к B10").fill("250000");

    const saveButton = settingsForm.getByRole("button", { name: /Сохранить|Сохраняем/ });
    const saveResponsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/goals") &&
        response.request().method() !== "GET",
      { timeout: 60_000 }
    );

    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    const saveResponse = await saveResponsePromise;
    expect(saveResponse.ok()).toBeTruthy();
    await expect(saveButton).toBeEnabled();
    await expect(settingsForm.getByLabel("Дата старта плана")).toHaveValue(planStartInput);

    await openAppPage(page, "/strategy/year", "План года");
    await expect(page.getByText(monthYearLabel(planStartDate)).first()).toBeVisible();
    await expect(page.getByText(monthYearLabel(followingMonth)).first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText(russianDateLabel(dayBeforePlanStart));

    await openAppPage(page, "/strategy/actions", "Неделя");
    const weeklyTakt = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Недельный такт", exact: true })
    });
    await expect(weeklyTakt).toHaveCount(1);
    await expect(
      weeklyTakt.getByText("План ещё не начался.", { exact: true })
    ).toBeVisible();
    await expect(weeklyTakt.getByText(/Текущая неделя:/)).toHaveCount(0);
    await expect(weeklyTakt.getByText("Разрыв недели", { exact: true })).toHaveCount(0);
    await expect(weeklyTakt.getByText("Разрыв месяца", { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Гипотезы недели", exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Действия дня", exact: true })
    ).toBeVisible();
    await expectAuthenticatedApp(page);
    await expectNoFatalError(page);
  });

  test("opens daily actions history and supports soft delete", async ({ page }) => {
    await openAppPage(page, "/strategy/actions/history", "Дневник действий");

    const marker = `E2E daily action ${Date.now()}`;
    const createResponse = await page.request.post("/api/daily-actions", {
      data: {
        date: "2026-06-17",
        type: "FIRST_TOUCH",
        target: marker,
        value: "E2E проверка ценности действия",
        nextStep: "E2E следующий шаг"
      }
    });
    expect(createResponse.ok()).toBeTruthy();
    const created = await createResponse.json();

    await page.goto("/strategy/actions/history");
    await page.getByPlaceholder("Кому, ценность, следующий шаг...").fill(marker);
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page.getByText(marker)).toBeVisible();

    const deleteResponse = await page.request.delete(`/api/daily-actions/${created.id}`);
    expect(deleteResponse.ok()).toBeTruthy();

    await page.goto("/strategy/actions/history");
    await page.getByPlaceholder("Кому, ценность, следующий шаг...").fill(marker);
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page.getByText(marker)).not.toBeVisible();

    await page.getByLabel("Показать удалённые").check();
    await page.getByRole("button", { name: "Найти" }).click();
    await expect(page.getByText(marker)).toBeVisible();
    await expect(page.getByText("Удалено")).toBeVisible();

    const restoreResponse = await page.request.patch(`/api/daily-actions/${created.id}`, {
      data: { restore: true }
    });
    expect(restoreResponse.ok()).toBeTruthy();

    const cleanupResponse = await page.request.delete(`/api/daily-actions/${created.id}`);
    expect(cleanupResponse.ok()).toBeTruthy();
  });

  test("lists and soft-deletes a confirmed WorkRecord", async ({ page }) => {
    const marker = `E2E work record ${Date.now()}`;
    const createResponse = await page.request.post("/api/work-records", {
      data: {
        title: marker,
        recordType: "DECISION",
        summary: "Нужно проверить отображение подтверждённой записи. После проверки запись можно удалить.",
        insight: "Список показывает только данные владельца.",
        nextStep: "Проверить мягкое удаление",
        relatedWeekStart: "2026-07-02"
      }
    });
    expect(createResponse.status()).toBe(201);

    await openAppPage(page, "/strategy/notes", "Рабочие записи");
    let card = page.getByTestId("work-record").filter({ hasText: marker });
    await expect(card).toBeVisible();
    await expect(card.getByText("Решение", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "Удалить" }).click();
    await expect(card).toHaveCount(0);

    await page.getByLabel("Показать удалённые").check();
    card = page.getByTestId("work-record").filter({ hasText: marker });
    await expect(card).toBeVisible();
    await expect(card.getByText(/удалена/)).toBeVisible();
  });
});
