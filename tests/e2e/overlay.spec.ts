import { expect, test, type Page } from "@playwright/test";

import { activate, calls, emit } from "./mock";

const panel = (page: Page) => page.locator("section.panel");

test.describe("scale setup", () => {
  test("cells → intersection → neighbour → wheel → Enter saves the scale", async ({ page }) => {
    await activate(page, { near: null });
    await expect(panel(page)).toContainText("шаг 1 из 4");
    await expect(panel(page)).toContainText("масштаб ещё не настроен");
    await page.keyboard.press("2");
    await expect(panel(page)).toContainText("шаг 2 из 4");
    await page.mouse.click(300, 300);
    await expect(panel(page)).toContainText("шаг 3 из 4");
    await page.mouse.move(420, 302);
    await expect(panel(page)).toContainText("120,0");
    await page.mouse.click(420, 302);
    await expect(panel(page)).toContainText("шаг 4 из 4");
    // 1 px lines have an empty box, so count them rather than ask for visibility.
    expect(await page.locator("svg.grid line").count()).toBeGreaterThan(10);
    await page.mouse.wheel(0, -100);
    await page.keyboard.press("Enter");

    const [save] = await calls(page, "save_calibration");
    expect(save?.args).toMatchObject({ seq: 1, preset: "near", calibration: { cellMeters: 100, origin: { x: 300, y: 300 } } });
    expect((save?.args?.calibration as { cellPx: number }).cellPx).toBeCloseTo(122.4, 1);
    await expect(panel(page)).toContainText("Сохранено для 1600×900 · 100 %");
    await expect(panel(page)).toContainText("должно выйти 300");
  });

  test("a refused save says so and keeps the scale for this session", async ({ page }) => {
    await activate(page, { near: null });
    await page.evaluate(() =>
      (window as unknown as { __MAPPER_MOCK__: { failures: Map<string, string> } }).__MAPPER_MOCK__.failures.set(
        "save_calibration",
        "read_only",
      ),
    );
    await page.keyboard.press("2");
    await page.mouse.click(300, 300);
    await page.mouse.click(400, 300);
    await page.keyboard.press("Enter");
    await expect(panel(page)).toContainText("Масштаб не сохранён: файл настроек от более новой версии Mapper");
    await expect(panel(page)).not.toContainText("Сохранено для");
    await page.mouse.click(400, 400);
    await page.mouse.click(700, 400);
    await expect(panel(page).locator(".big-number")).toHaveText("300 м");
  });

  test("the cell buttons choose on step 1, and the right button steps back", async ({ page }) => {
    await activate(page, { near: null });
    await page.getByRole("button", { name: /Большие клетки/ }).click();
    await expect(panel(page)).toContainText("шаг 2 из 4");
    await page.mouse.click(500, 500, { button: "right" });
    await expect(panel(page)).toContainText("шаг 1 из 4");
  });

  test("Esc without any scale leaves the overlay", async ({ page }) => {
    await activate(page, { near: null });
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await calls(page, "overlay_exit"))[0]?.args).toEqual({ seq: 1, reason: "noCalibration" });
  });
});

test.describe("measuring", () => {
  test("3 cells of 100 m give 300 m with its error", async ({ page }) => {
    await activate(page);
    await page.mouse.click(400, 300);
    await expect(panel(page)).toContainText("Кликни вторую точку");
    await page.mouse.click(700, 300);
    await expect(panel(page).locator(".big-number")).toHaveText("300 м");
    await expect(panel(page)).toContainText("± 2 м");
    await expect(page.locator("svg.route .label").first()).toHaveText("300 м");
  });

  test("a route lists its segments; the right button removes the last point", async ({ page }) => {
    await activate(page);
    await page.mouse.click(400, 300);
    await page.mouse.click(700, 300);
    await page.mouse.click(700, 700);
    await expect(panel(page)).toContainText("2 отрезка: 300 + 400 м");
    await expect(panel(page)).toContainText("Миномёт — только для 2 точек");
    await expect(page.locator("svg.route .total")).toContainText("всего 700");
    await page.mouse.click(900, 800, { button: "right" });
    await expect(panel(page).locator(".big-number")).toHaveText("300 м");
  });

  test("the wheel sets the target height and the mortar answers", async ({ page }) => {
    await activate(page);
    await page.mouse.click(400, 400);
    await page.mouse.click(800, 400);
    for (let i = 0; i < 35; i += 1) await page.mouse.wheel(0, -100);
    await expect(panel(page)).toContainText("ΔH +35 м — цель выше");
    await expect(panel(page)).toContainText("Миномёт 412 м");
  });

  test("Ctrl+wheel adjusts the scale and saves it after a pause; G hides the grid", async ({ page }) => {
    await activate(page);
    await page.mouse.move(800, 450);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -100);
    await page.keyboard.up("Control");
    await expect(panel(page)).toContainText("Масштаб подогнан");
    await expect.poll(async () => (await calls(page, "save_calibration")).length, { timeout: 3000 }).toBe(1);
    await expect(panel(page)).toContainText("Сохранено для 1600×900 · 100 %");
    expect(await page.locator("svg.grid line").count()).toBeGreaterThan(0);
    await page.keyboard.press("g");
    await expect(page.locator("svg.grid line")).toHaveCount(0);
  });

  test("changing the zoom carries the route: park, zoom, anchor click", async ({ page }) => {
    const { w, h } = await activate(page);
    // Zoomed out: 1 km cells of 100 px, ten times the metres per pixel of the near scale.
    const far = { cellMeters: 1000, cellPx: 100, origin: { x: 0, y: 0 }, w, h, scale: 1, createdAt: "2026-10-22T00:00:00Z" };
    await activate(page, { far });
    await page.mouse.click(400, 300);
    await page.mouse.click(700, 300);
    await emit(page, "overlay-preset", { seq: 1, preset: "far" });
    await page.keyboard.up("w");
    await expect.poll(async () => (await calls(page, "overlay_exit"))[0]?.args).toEqual({ seq: 1, reason: "switchZoom" });
    await emit(page, "overlay-blank-request", { seq: 1, reason: "exit" });
    await expect.poll(async () => (await calls(page, "overlay_blank")).length).toBe(1);
    expect(await calls(page, "submit_result")).toHaveLength(0);

    await activate(page, { preset: "far", far });
    await expect(panel(page)).toContainText("Кликни, где сейчас первая точка маршрута");
    await page.mouse.move(800, 450);
    await expect(page.locator("svg.ghost circle")).toHaveCount(2);
    await page.mouse.click(800, 450);
    await expect(panel(page)).toContainText("Маршрут перенесён в новый масштаб");
    await expect(panel(page).locator(".big-number")).toHaveText("300 м");
    await expect(page.locator("svg.route circle.point")).toHaveCount(2);
  });

  test("the same zoom again brings the points back in place", async ({ page }) => {
    await activate(page);
    await page.mouse.click(400, 300);
    await page.mouse.click(700, 300);
    await emit(page, "overlay-preset", { seq: 1, preset: "far" });
    await page.keyboard.up("w");
    await emit(page, "overlay-blank-request", { seq: 1, reason: "exit" });
    await activate(page);
    await expect(panel(page).locator(".big-number")).toHaveText("300 м");
  });
});

test.describe("leaving", () => {
  test("Esc hands focus back only after the key is released", async ({ page }) => {
    await activate(page);
    await page.keyboard.down("Escape");
    await page.waitForTimeout(100);
    expect(await calls(page, "overlay_exit")).toHaveLength(0);
    await page.keyboard.up("Escape");
    await expect.poll(async () => (await calls(page, "overlay_exit"))[0]?.args).toEqual({ seq: 1, reason: "esc" });
  });

  test("the same hotkey again waits for its key-up", async ({ page }) => {
    await activate(page);
    await emit(page, "overlay-exit-request", { seq: 1 });
    await page.waitForTimeout(100);
    expect(await calls(page, "overlay_exit")).toHaveLength(0);
    await page.keyboard.up("q");
    await expect.poll(async () => (await calls(page, "overlay_exit"))[0]?.args).toEqual({ seq: 1, reason: "hotkey" });
  });

  test("the blank request hands over the result, then confirms an empty frame", async ({ page }) => {
    await activate(page);
    await page.mouse.click(400, 300);
    await page.mouse.click(700, 300);
    await emit(page, "overlay-blank-request", { seq: 1, reason: "exit" });
    await expect.poll(async () => (await calls(page)).map((c) => c.command).filter((c) => c !== "log_line")).toEqual([
      "submit_result",
      "overlay_blank",
    ]);
    const [submit] = await calls(page, "submit_result");
    expect(submit?.args).toMatchObject({ seq: 1, result: { preset: "near", totalM: 300, segmentsM: [300] } });
    await expect(page.locator(".root")).toHaveCount(0);
  });

  test("without focus the first click only starts the session", async ({ page }) => {
    await activate(page, { ok: false });
    await expect(page.getByText("Кликни, чтобы начать замер")).toBeVisible();
    await expect(page.getByText(/Закроется через [123] с/)).toBeVisible();
    await page.mouse.click(400, 300);
    await emit(page, "overlay-focused", { seq: 1 });
    await expect(page.getByText("Кликни, чтобы начать замер")).toHaveCount(0);
    await expect(panel(page)).toContainText("Кликни первую точку");
  });
});

test("the panel follows the glass density setting", async ({ page }) => {
  await activate(page, { opacity: 0.8 });
  const color = await panel(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(color).toBe("rgba(14, 16, 20, 0.8)");
});

test("English texts and number format", async ({ page }) => {
  await activate(page, { language: "en" });
  await page.mouse.click(100, 300);
  await page.mouse.click(1350, 300);
  await expect(panel(page).locator(".big-number")).toHaveText("1,250 m");
  await expect(panel(page)).toContainText("Mortar — beyond 700 m — out of range");
});
