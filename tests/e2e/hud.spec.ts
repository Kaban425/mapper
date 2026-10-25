import { expect, test } from "@playwright/test";

import { calls, emit } from "./mock";

const result = {
  preset: "near",
  totalM: 412,
  errorM: 1.2,
  segmentsM: [412],
  dhM: 35,
  mortar: { status: "ok", sightM: 424.1 },
  travel: { sprintS: 65.4, daciaS: 14.8, daciaVerified: false },
};

test.beforeEach(async ({ page }) => {
  await page.goto("/hud.html");
  await page.waitForFunction(() => "__MAPPER_MOCK__" in window);
  await page.waitForTimeout(50);
});

test("shows the result in Russian and never calls a command", async ({ page }) => {
  await emit(page, "hud-show", { kind: "result", result, lang: "ru", opacity: 0.86 });
  const hud = page.locator("main.hud");
  await expect(hud).toContainText("Mapper · Приближено");
  await expect(hud.locator(".big")).toHaveText("412 м");
  await expect(hud).toContainText("Бегом ≈ 1:05 · Dacia ≈ 0:15");
  await expect(hud).toContainText("Миномёт 424 м · ΔH +35 м");
  expect(await hud.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgba(14, 16, 20, 0.86)");
  expect(await calls(page)).toEqual([]);
});

test("a route and an out-of-range mortar in English", async ({ page }) => {
  await emit(page, "hud-show", {
    kind: "result",
    result: { ...result, preset: "far", totalM: 3480, segmentsM: [3480], mortar: { status: "tooFar", sightM: null } },
    lang: "en",
    opacity: 0.9,
  });
  await expect(page.locator("main.hud")).toContainText("Mapper · Zoomed out");
  await expect(page.locator("main.hud .big")).toHaveText("3,480 m");
  await expect(page.locator("main.hud .warn")).toContainText("Mortar — beyond 700 m — out of range");
  await emit(page, "hud-show", {
    kind: "result",
    result: { ...result, segmentsM: [200, 212], mortar: { status: "notApplicable", sightM: null } },
    lang: "en",
    opacity: 0.9,
  });
  await expect(page.locator("main.hud")).toContainText("2 segments · ΔH +35 m");
});

test("tells how to continue a parked route", async ({ page }) => {
  await emit(page, "hud-show", { kind: "notice", code: "routeKept", hotkey: "Alt+W", lang: "ru", opacity: 0.65 });
  const hud = page.locator("main.hud");
  await expect(hud).toContainText("Маршрут запомнен");
  await expect(hud).toContainText("Смени зум и нажми Alt+W");
});

test("ignores a malformed payload", async ({ page }) => {
  await emit(page, "hud-show", { kind: "result", result: { totalM: "<img src=x>" }, lang: "ru", opacity: 1 });
  await expect(page.locator("main.hud")).toHaveCount(0);
});
