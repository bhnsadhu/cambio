import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomBytes } from "node:crypto";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const password = "A complete game test password 84!";
async function fits(page: Page, width: number) {
  await page.setViewportSize({ width, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const overflowing = await page.locator("main button, main input, [role=dialog] button").evaluateAll((elements) => elements.filter((element) => {
    if (!element.getClientRects().length) return false;
    const rect = element.getBoundingClientRect();
    return rect.left < -1 || rect.right > innerWidth + 1;
  }).map((element) => element.getAttribute("aria-label") ?? element.textContent));
  expect(overflowing).toEqual([]);
}
async function state(context: BrowserContext, code: string) {
  return (await (await context.request.get(`/api/games/${code}/state`)).json()).view.public;
}

for (const mode of ["guest", "account"] as const) {
  test(`${mode} can play a complete round, use help and pause, and continue from the results on any screen`, async ({ page, context }) => {
    test.setTimeout(150_000);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const name = mode === "guest" ? "Guest Casey" : "Alexandria Collins";
    if (mode === "account") {
      const result = await context.request.post("/api/account", { headers: { origin }, data: { username: `game${randomBytes(5).toString("hex")}`, displayName: name, password } });
      expect(result.status()).toBe(201);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    if (mode === "guest") await page.getByLabel("Display name", { exact: true }).fill(name);
    await fits(page, 320);
    await page.getByRole("button", { name: "Open a table", exact: true }).click();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    const code = page.url().split("/").at(-1)!;
    for (const width of [320, 390, 768, 1280, 1440]) await fits(page, width);
    await fits(page, 390);
    await page.screenshot({ path: `test-results/lobby-${mode}-mobile.png`, fullPage: true });
    if (mode === "guest") await expect(page.getByRole("switch", { name: "Do not disturb" })).toHaveCount(0);
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("Clipboard unavailable")); });
    await page.getByRole("button", { name: "Copy link" }).click();
    await expect(page.getByText("Copying is unavailable. Share the code above instead.")).toBeVisible();
    await page.getByRole("button", { name: "How to play", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "How to play", exact: true })).toBeVisible();
    await fits(page, 320);
    await page.getByRole("dialog", { name: "How to play", exact: true }).getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("button", { name: "Start round", exact: true }).click();
    const actions = page.getByRole("region", { name: "Round actions" });
    await expect(actions.getByRole("button", { name: "I'm ready", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "face down card", exact: true })).toHaveCount(16);
    for (const width of [320, 390, 768, 1280, 1440]) await fits(page, width);
    await page.screenshot({ path: `test-results/table-${mode}-desktop.png`, fullPage: true });
    await fits(page, 390);
    if (mode === "account") {
      const toggle = page.getByRole("switch", { name: "Do not disturb" });
      expect(await toggle.evaluate((element) => element.closest('nav[aria-label="Table controls"]') !== null)).toBe(true);
      await toggle.click(); await expect(toggle).toBeChecked();
      expect((await toggle.boundingBox())!.height).toBeLessThanOrEqual(32);
      await toggle.click(); await expect(toggle).not.toBeChecked();
    }
    await actions.getByRole("button", { name: "I'm ready", exact: true }).click();
    await expect.poll(async () => (await state(context, code)).phase, { timeout: 20_000 }).toBe("playing");
    await page.reload();
    await expect(page.getByRole("region", { name: `${name}'s hand`, exact: true })).toContainText("You");
    await expect(page.getByRole("form", { name: "Join table" })).toHaveCount(0);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    const paused = page.getByRole("dialog", { name: "Table paused", exact: true });
    await expect(paused).toBeVisible();
    await fits(page, 320);
    await paused.getByRole("button", { name: "Ask to resume", exact: true }).click();
    await expect(paused).toHaveCount(0);
    await actions.getByRole("button", { name: "Draw", exact: true }).click();
    if (mode === "account") {
      await page.getByRole("region", { name: "Cameron's hand", exact: true }).getByRole("button", { name: "Push this card", exact: true }).first().click();
      await expect(actions.getByRole("button", { name: "Push it onto Cameron", exact: true })).toBeVisible();
      await fits(page, 320);
      await actions.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    // Let the drawn card's short flight finish before the visual review.
    await page.waitForTimeout(800);
    await page.screenshot({ path: `test-results/table-${mode}-mobile.png`, fullPage: true });
    await actions.getByRole("button", { name: /^Place .* on the pile$/ }).click();
    const results = page.getByRole("dialog", { name: "Round results", exact: true });
    const deadline = Date.now() + 75_000;
    while (Date.now() < deadline && await results.count() === 0) {
      const skip = actions.getByRole("button", { name: "Skip the power", exact: true });
      const call = actions.getByRole("button", { name: "Call Cambio", exact: true });
      const draw = actions.getByRole("button", { name: "Draw", exact: true });
      const place = actions.getByRole("button", { name: /^Place .* on the pile$/ });
      if (await skip.isVisible() && await skip.isEnabled()) await skip.click();
      else if (await call.isVisible() && await call.isEnabled()) await call.click();
      else if (await draw.isVisible() && await draw.isEnabled()) await draw.click();
      else if (await place.isVisible() && await place.isEnabled()) await place.click();
      else await page.waitForTimeout(500);
    }
    await expect(results).toBeVisible();
    for (const width of [320, 390, 768, 1280, 1440]) await fits(page, width);
    await page.screenshot({ path: `test-results/results-${mode}-desktop.png` });
    await fits(page, 390);
    await expect(results.getByRole("list", { name: "Final hands and scores" }).getByRole("listitem")).toHaveCount(4);
    const scored = await state(context, code);
    for (const player of scored.players) {
      const score = scored.results.at(-1).scores.find((row: { playerId: string }) => row.playerId === player.id).score;
      await expect(results.getByRole("listitem", { name: `${player.name}'s result`, exact: true }).locator("p").filter({ hasText: new RegExp(`^${score}$`) })).toBeVisible();
    }
    await results.getByRole("heading").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/results-${mode}-mobile.png` });
    expect(await page.locator("main").innerText()).not.toMatch(/[—–]|\s-\s|\w-\w/);
    if (mode === "account") {
      const record = await (await context.request.get("/api/account")).json();
      expect(record.profile.roundsPlayed).toBe(1);
      expect(record.profile.points).toBeGreaterThanOrEqual(3);
      const board = await (await context.request.get("/api/leaderboard?scope=friends")).json();
      expect(board.me.points).toBe(record.profile.points);
      await results.getByRole("button", { name: "Leave", exact: true }).click();
      await expect(page).toHaveURL(`${origin}/`);
      await page.getByRole("link", { name: "Your record", exact: true }).click();
      await fits(page, 320);
      await page.getByRole("link", { name: "Leaderboard", exact: true }).click();
      await expect(page.getByLabel("Your standing")).toContainText("1st of 1");
      await fits(page, 320);
    } else {
      await results.getByRole("button", { name: "I'm ready", exact: true }).click();
      await expect(results).toHaveCount(0);
      await expect(actions.getByRole("button", { name: "I'm ready", exact: true })).toBeVisible();
      await expect.poll(async () => (await state(context, code)).round).toBe(2);
      await expect(page.getByRole("switch", { name: "Do not disturb" })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });
}

test("walkthrough fits a small screen, Enter advances once, and keyboard focus stays inside help", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "How to play", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "How Cambio works" });
  await dialog.getByRole("button", { name: "Next", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toContainText("2 of 4");
  await page.keyboard.press("Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(dialog).toContainText("3 of 4");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const next = dialog.getByRole("button", { name: "Next", exact: true });
  await next.scrollIntoViewIfNeeded();
  const rect = (await next.boundingBox())!;
  expect(rect.y + rect.height).toBeLessThanOrEqual(568);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  const rules = page.getByRole("dialog", { name: "How to play", exact: true });
  await rules.getByRole("button", { name: "Show walkthrough again" }).focus();
  await page.keyboard.press("Tab");
  await expect(rules.getByRole("button", { name: "Close", exact: true })).toBeFocused();
});

test("connection failures offer a retry and a failed leave keeps the guest's seat", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("Display name", { exact: true }).fill("Connection Check");
  await page.getByRole("button", { name: "Open a table", exact: true }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  const url = page.url();
  const code = url.split("/").at(-1)!;
  await page.route(`**/api/games/${code}/actions`, (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Could not leave. Try again." } }) }));
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page.getByText("Could not leave. Try again.")).toBeVisible();
  await expect(page).toHaveURL(url);
  expect((await state(context, code)).players).toHaveLength(1);
  await page.unroute(`**/api/games/${code}/actions`);
  await page.route(`**/api/games/${code}/state`, (route) => route.abort());
  await page.reload();
  await expect(page.getByRole("heading", { name: "Could not reach the table." })).toBeVisible();
  await fits(page, 320);
  await page.unroute(`**/api/games/${code}/state`);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  expect((await state(context, code)).players).toHaveLength(0);
});
