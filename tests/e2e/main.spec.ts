import { expect, test, type Page } from "@playwright/test";

import { calibration, freshSnapshot, openMain, push, type Snapshot } from "./main-mock";
import { calls, emit } from "./mock";

const heading = (page: Page) => page.locator("h1");
const patches = async (page: Page) =>
  (await calls(page, "update_settings")).map((c) => (c.args as { patch: Record<string, unknown> }).patch);

function homeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  const fresh = freshSnapshot();
  return freshSnapshot({
    settings: { ...fresh.settings, firstRunDone: true, wizardStep: 4, riskAccepted: true },
    scales: [{ ...fresh.scales[0]!, near: calibration(100, 170.4) }],
    ...overrides,
  });
}

test.describe("first-run wizard", () => {
  test("four steps: the risk tick gates Next, the language switches at once, the scales follow the game", async ({ page }) => {
    const fresh = freshSnapshot();
    await openMain(page, fresh);
    await expect(heading(page)).toHaveText("Линейка для карты PUBG");

    await page.getByRole("radio", { name: "English" }).click();
    await expect(heading(page)).toHaveText("A ruler for the PUBG map");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.getByRole("radio", { name: "Русский" }).click();
    await expect(heading(page)).toHaveText("Линейка для карты PUBG");

    await page.getByRole("button", { name: "Далее" }).click();
    await expect(heading(page)).toHaveText("Честно о риске");
    const next = page.getByRole("button", { name: "Далее" });
    await expect(next).toBeDisabled();
    await expect(page.getByText("Отметь, что понимаешь риск")).toBeVisible();
    await page.getByLabel("Я прочитал и понимаю риск").check();
    await expect(next).toBeEnabled();
    await next.click();

    await expect(heading(page)).toHaveText("Режим экрана в PUBG");
    await page.getByRole("button", { name: "Далее" }).click();
    await expect(heading(page)).toHaveText("Настрой две линейки");
    await expect(page.getByText("Ждём Alt+Q в игре")).toBeVisible();
    await expect(page.getByText("Ждём Alt+W в игре")).toBeVisible();
    const done = page.getByRole("button", { name: "Готово" });
    await expect(done).toBeDisabled();

    const step4 = { ...fresh.settings, wizardStep: 4, riskAccepted: true };
    await push(page, freshSnapshot({ settings: step4, overlay: { preset: "near", start: "calibrate" } }));
    await expect(page.getByText("Alt+Q сработал · идёт настройка")).toBeVisible();
    const both = [{ ...fresh.scales[0]!, near: calibration(100, 170.4), far: calibration(1000, 120) }];
    await push(page, freshSnapshot({ settings: step4, scales: both }));
    await expect(page.getByText("Готово · 2560×1440 · 125 %")).toHaveCount(2);
    await done.click();

    await expect(heading(page)).toHaveText("Главная");
    expect(await patches(page)).toEqual([
      { language: "en" },
      { language: "ru" },
      { wizardStep: 2 },
      { riskAccepted: true },
      { wizardStep: 3 },
      { wizardStep: 4 },
      { firstRunDone: true },
    ]);
  });

  test("Enter is Next and Alt+Left is Back", async ({ page }) => {
    await openMain(page, freshSnapshot());
    await expect(heading(page)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(heading(page)).toHaveText("Честно о риске");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(heading(page)).toHaveText("Линейка для карты PUBG");
  });
});

test.describe("hotkeys", () => {
  test("a new combination is checked here, then by Rust; a busy one is refused; Esc cancels", async ({ page }) => {
    await openMain(page, homeSnapshot());
    await page.getByRole("button", { name: "Настройки" }).click();
    await page.getByRole("button", { name: "Изменить сочетание: Замер при отдалении, сейчас Alt+W" }).click();
    await expect.poll(async () => (await calls(page, "suspend_hotkeys"))[0]?.args).toEqual({ suspended: true });
    const capture = page.getByRole("textbox", { name: "Замер при отдалении" });
    await expect(capture).toBeFocused();
    await expect(page.getByText("Пока идёт запись, Alt+Q и Alt+W не работают")).toBeVisible();

    await page.keyboard.press("q");
    await expect(page.getByText(/Одной клавишей можно только F1–F24/)).toBeVisible();
    await page.keyboard.press("Alt+KeyQ");
    await expect(page.getByText("Это сочетание уже у режима «Приближено»")).toBeVisible();
    expect(await calls(page, "set_hotkey")).toHaveLength(0);

    await page.keyboard.press("Alt+KeyE");
    await expect(page.getByText("Alt+E свободно — сохранено")).toBeVisible();
    expect((await calls(page, "set_hotkey"))[0]?.args).toEqual({ preset: "far", accelerator: "Alt+E" });
    await expect.poll(async () => (await calls(page, "suspend_hotkeys")).at(-1)?.args).toEqual({ suspended: false });

    await page.evaluate(() =>
      (window as unknown as { __MAPPER_MOCK__: { failures: Map<string, string> } }).__MAPPER_MOCK__.failures.set("set_hotkey", "hotkey_busy"),
    );
    await page.getByRole("button", { name: "Изменить сочетание: Замер при отдалении, сейчас Alt+E" }).click();
    await page.keyboard.press("Alt+KeyR");
    await expect(page.getByText("Alt+R занято другой программой. Выбери другое.")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Изменить сочетание: Замер при отдалении, сейчас Alt+E" })).toBeFocused();
    await expect.poll(async () => (await calls(page, "suspend_hotkeys")).at(-1)?.args).toEqual({ suspended: false });
  });

  test("recording ends when Rust brings the hotkeys back on its own", async ({ page }) => {
    await openMain(page, homeSnapshot());
    await page.getByRole("button", { name: "Настройки" }).click();
    await page.getByRole("button", { name: "Изменить сочетание: Замер при приближении, сейчас Alt+Q" }).click();
    await expect(page.getByRole("textbox", { name: "Замер при приближении" })).toBeVisible();
    // The 30 s limit or the window losing focus: Rust resumes and says so.
    await push(page, homeSnapshot());
    await expect(page.getByRole("textbox", { name: "Замер при приближении" })).toHaveCount(0);
    await expect(page.getByText("Пока идёт запись, Alt+Q и Alt+W не работают")).toHaveCount(0);
  });

  test("Defaults bring back a swapped pair in one step", async ({ page }) => {
    const swapped = homeSnapshot();
    await openMain(
      page,
      homeSnapshot({
        settings: { ...swapped.settings, hotkeys: { near: "Alt+W", far: "Alt+Q" } },
        hotkeys: { near: { accelerator: "Alt+W", registered: true }, far: { accelerator: "Alt+Q", registered: true }, suspended: false },
      }),
    );
    await page.keyboard.press("Control+Digit2");
    await page.getByRole("button", { name: "По умолчанию" }).click();
    await expect(page.getByRole("button", { name: "Изменить сочетание: Замер при приближении, сейчас Alt+Q" })).toBeVisible();
    expect(await calls(page, "reset_hotkeys")).toHaveLength(1);
    expect(await calls(page, "set_hotkey")).toHaveLength(0);
  });

  test("a busy hotkey on Home leads straight to its recorder", async ({ page }) => {
    const busy = { accelerator: "Alt+W", registered: false, error: "busy" as const };
    await openMain(page, homeSnapshot({ hotkeys: { ...homeSnapshot().hotkeys, far: busy } }));
    await expect(page.getByRole("alert")).toHaveText("Alt+W занят другой программой");
    await page.getByRole("button", { name: "Выбрать другое сочетание" }).click();
    await expect(heading(page)).toHaveText("Настройки");
    await expect(page.getByRole("button", { name: "Изменить сочетание: Замер при отдалении, сейчас Alt+W" })).toBeFocused();
  });
});

test.describe("home", () => {
  test("Recalibrate arms the hotkey; Reset asks first with Cancel focused", async ({ page }) => {
    await openMain(page, homeSnapshot());
    await page.getByRole("button", { name: "Перенастроить" }).click();
    await expect(page.getByText("Нажми Alt+Q над картой — откроется настройка.")).toBeVisible();
    expect((await calls(page, "arm_calibration"))[0]?.args).toEqual({ preset: "near" });
    await page.getByRole("button", { name: "Отменить" }).click();
    expect((await calls(page, "arm_calibration"))[1]?.args).toEqual({ preset: null });

    await page.getByRole("button", { name: "Сбросить" }).click();
    const dialog = page.getByRole("dialog", { name: "Сбросить масштаб «Приближено»?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Отмена" })).toBeFocused();
    await dialog.getByRole("button", { name: "Сбросить" }).click();
    await expect(dialog).toHaveCount(0);
    expect((await calls(page, "reset_calibration"))[0]?.args).toEqual({ monitorKey: "2560x1440@125", preset: "near" });
    await expect(page.getByText("Масштаб не настроен")).toHaveCount(2);
  });

  test("the last measurement reads like the HUD", async ({ page }) => {
    const result = {
      preset: "near" as const,
      totalM: 1240,
      errorM: 2.1,
      segmentsM: [640, 600],
      dhM: 0,
      mortar: { status: "notApplicable" as const, sightM: null },
      travel: { sprintS: 196.8, daciaS: 44.6, daciaVerified: false },
    };
    await openMain(page, homeSnapshot({ lastMeasurement: { result, monitorKey: "2560x1440@125", at: Date.now() } }));
    const last = page.locator("section.last");
    await expect(last).toContainText("1 240 м");
    await expect(last).toContainText("2 отрезка: 640 + 600 м");
    await expect(last).toContainText("Бегом ≈ 3:17 · Dacia ≈ 0:45 · Миномёт — только для 2 точек");
  });
});

test.describe("narrow window (200 % zoom of 960 × 640)", () => {
  test.use({ viewport: { width: 480, height: 320 } });

  test("nothing scrolls sideways on any screen or wizard step", async ({ page }) => {
    const fits = async () => {
      const sizes = await page.evaluate(() =>
        [document.documentElement, ...document.querySelectorAll(".content, .body")].map((el) => [el.scrollWidth, el.clientWidth]),
      );
      for (const [scroll, client] of sizes) expect(scroll).toBeLessThanOrEqual(client!);
    };
    await openMain(page, freshSnapshot());
    for (let step = 1; step <= 4; step += 1) {
      await fits();
      if (step === 2) await page.getByLabel("Я прочитал и понимаю риск").check();
      if (step < 4) await page.getByRole("button", { name: "Далее" }).click();
    }
    await push(page, homeSnapshot());
    for (const screen of ["Главная", "Настройки", "О программе"]) {
      await page.getByRole("button", { name: screen, exact: true }).click();
      await fits();
    }
  });
});

test.describe("new version", () => {
  test("Home offers it until Later; Settings says when Mapper last asked", async ({ page }) => {
    const update = { state: "available" as const, latest: "v1.1.0", current: "0.1.0", checkedAt: 1_792_919_290, dismissed: false };
    await openMain(page, homeSnapshot({ update }));
    const banner = page.getByRole("region", { name: "Доступна версия 1.1.0 (у тебя 0.1.0)" });
    await expect(banner).toBeVisible();
    await banner.getByRole("button", { name: "Что нового и скачать" }).click();
    expect((await calls(page, "open_link"))[0]?.args).toEqual({ link: "releases" });
    await banner.getByRole("button", { name: "Позже" }).click();
    await expect(banner).toHaveCount(0);
    expect(await patches(page)).toEqual([{ dismissUpdate: "v1.1.0" }]);

    await page.keyboard.press("Control+Digit2");
    await expect(page.getByText(/^Последняя проверка: .+ — доступна версия 1\.1\.0$/)).toBeVisible();
    await page.getByRole("button", { name: "Проверить сейчас" }).click();
    await expect(page.getByText("Проверяем…")).toBeVisible();
    await expect(page.getByRole("button", { name: "Проверить сейчас" })).toBeDisabled();
  });

  test("a build without the repository address makes no request and says so", async ({ page }) => {
    const update = { state: "noRepository" as const, latest: null, current: "0.1.0", checkedAt: null, dismissed: false };
    await openMain(page, homeSnapshot({ update }));
    await page.keyboard.press("Control+Digit2");
    await expect(page.getByText("Адрес репозитория ещё не задан: эта сборка никуда не обращается")).toBeVisible();
    await expect(page.getByRole("button", { name: "Проверить сейчас" })).toHaveCount(0);
  });
});

test.describe("window", () => {
  test("the first close shows the tray dialog; Got it hides to the tray", async ({ page }) => {
    await openMain(page, homeSnapshot());
    await emit(page, "tray-hint", {});
    const dialog = page.getByRole("dialog", { name: "Mapper остаётся в трее" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Понятно" })).toBeFocused();
    await dialog.getByRole("button", { name: "Понятно" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await calls(page, "hide_main_window")).toHaveLength(1);
  });

  test("a speed out of range is not sent; a good one is saved", async ({ page }) => {
    await openMain(page, homeSnapshot());
    await page.keyboard.press("Control+Digit2");
    await expect(heading(page)).toHaveText("Настройки");
    const sprint = page.getByLabel("Спринт, м/с");
    await sprint.fill("12");
    await sprint.press("Enter");
    await expect(sprint).toHaveAttribute("aria-invalid", "true");
    expect(await calls(page, "update_settings")).toHaveLength(0);
    await sprint.fill("7,5");
    await sprint.press("Enter");
    await expect.poll(async () => patches(page)).toEqual([{ sprintMps: 7.5 }]);
    await expect(sprint).not.toHaveAttribute("aria-invalid", "true");
  });

  test("Ctrl+3 opens About and Ctrl+plus zooms the window", async ({ page }) => {
    await openMain(page, homeSnapshot());
    await page.keyboard.press("Control+Digit3");
    await expect(heading(page)).toHaveText("Mapper 0.1.0 · for PUBG: BATTLEGROUNDS");
    await page.keyboard.press("Control+Equal");
    await expect.poll(async () => patches(page)).toEqual([{ uiZoom: 1.1 }]);
    await page.keyboard.press("Control+Digit0");
    await expect.poll(async () => patches(page)).toEqual([{ uiZoom: 1.1 }, { uiZoom: 1 }]);
  });
});
