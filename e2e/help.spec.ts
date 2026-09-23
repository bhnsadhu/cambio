import { test, expect, type Locator, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { makeCtx, started } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const helpButton = (page: Page) => page.getByRole("button", { name: "How to play", exact: true });
const walkthrough = (page: Page) => page.getByRole("dialog", { name: "How Cambio works", exact: true });
const rules = (page: Page) => page.getByRole("dialog", { name: "How to play", exact: true });

async function insideViewport(locator: Locator) {
  const box = (await locator.boundingBox())!;
  const viewport = locator.page().viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
}

test("first help visit is the walkthrough; later visits are scrollable rules with a replay", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 640 });
  await page.goto("/");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(helpButton(page)).toHaveCount(1);
  await helpButton(page).click();
  await expect(walkthrough(page)).toBeVisible();
  await insideViewport(walkthrough(page).locator(":scope > div"));
  await expect(walkthrough(page)).toContainText("1 of 4");
  await page.keyboard.press("ArrowRight");
  await expect(walkthrough(page)).toContainText("2 of 4");
  await page.keyboard.press("ArrowLeft");
  await expect(walkthrough(page)).toContainText("1 of 4");
  for (let index = 0; index < 3; index++) await walkthrough(page).getByRole("button", { name: "Next", exact: true }).click();
  await walkthrough(page).getByRole("button", { name: "Got it", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(helpButton(page)).toBeFocused();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cambio:prefs")!).onboarded)).toBe(true);

  await helpButton(page).click();
  await expect(rules(page)).toBeVisible();
  await expect(walkthrough(page)).toHaveCount(0);
  await insideViewport(rules(page).locator("aside"));
  for (const title of ["Goal", "Your turn", "Powers", "Sticking", "Cambio", "Scores"]) {
    await expect(rules(page).getByRole("heading", { name: title, exact: true })).toBeAttached();
  }
  const replay = rules(page).getByRole("button", { name: "Show walkthrough again", exact: true });
  await replay.scrollIntoViewIfNeeded();
  expect(await replay.evaluate((button) => button.parentElement!.parentElement!.scrollTop)).toBeGreaterThan(0);
  await insideViewport(replay);
  await replay.click();
  await expect(rules(page)).toHaveCount(0);
  await expect(walkthrough(page)).toContainText("1 of 4");
  await walkthrough(page).getByRole("button", { name: "Read full rules", exact: true }).click();
  await expect(walkthrough(page)).toHaveCount(0);
  await expect(rules(page)).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(rules(page).getByRole("button", { name: "Show walkthrough again", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(rules(page).getByRole("button", { name: "Close", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(helpButton(page)).toBeFocused();
  await page.reload();
  await helpButton(page).click();
  await expect(rules(page)).toBeVisible();
});

test("help is reachable from every main website header, including account and login", async ({ page, context }) => {
  const username = `help${randomBytes(5).toString("hex")}`;
  const registered = await context.request.post("/api/account", { headers: { origin }, data: { username, displayName: "Help Player", password: "Help navigation password 42!" } });
  expect(registered.status()).toBe(201);
  const { profile } = await registered.json();
  await page.addInitScript(() => localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true })));
  for (const path of ["/", "/leaderboard", `/p/${profile.handle}`, "/me"]) {
    await page.goto(path);
    await expect(page.getByRole("link", { name: "Account settings", exact: true })).toBeVisible();
    for (const width of [1024, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(helpButton(page)).toHaveCount(1);
      await insideViewport(helpButton(page));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await helpButton(page).click();
    await expect(rules(page)).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await rules(page).getByRole("button", { name: "Close", exact: true }).click();
    await expect(helpButton(page)).toBeFocused();
  }
  await context.request.post("/api/account/logout", { headers: { origin } });
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  await helpButton(page).click();
  await expect(rules(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("form", { name: "Log in", exact: true })).toBeVisible();
});

test("joining a first table introduces the game once and carries that choice between screens", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Display name", { exact: true }).fill("New player");
  await page.getByRole("button", { name: "Open a table", exact: true }).click();
  await expect(walkthrough(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await walkthrough(page).getByRole("button", { name: "Read full rules", exact: true }).click();
  await expect(walkthrough(page)).toHaveCount(0);
  await expect(rules(page)).toBeVisible();
  await rules(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await helpButton(page).click();
  await expect(rules(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Cambio home", exact: true }).click();
  await helpButton(page).click();
  await expect(rules(page)).toBeVisible();
});

test("missing and unreachable tables still offer help without forcing a walkthrough", async ({ page }) => {
  await page.goto("/g/ZZZZZ");
  await expect(page.getByRole("heading", { name: "No table with that code.", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await helpButton(page).click();
  await expect(walkthrough(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(helpButton(page)).toBeFocused();
  await page.route("**/api/games/ZZZZZ/state", (route) => route.fulfill({ status: 503, json: { error: { message: "Connection unavailable." } } }));
  await page.reload();
  await expect(page.getByRole("heading", { name: "Could not reach the table.", exact: true })).toBeVisible();
  await helpButton(page).click();
  await expect(rules(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
});

test("spectators can choose the walkthrough and refer to rules while watching", async ({ page }) => {
  const { state } = started(makeCtx(3, Date.now() - 10_001));
  await page.route(`**/api/games/${state.code}/state`, (route) => route.fulfill({ json: { view: projectFor(state, 1, null, Date.now()), me: null } }));
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await page.goto(`/g/${state.code}`);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await helpButton(page).click();
  await expect(walkthrough(page)).toBeVisible();
  await walkthrough(page).getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("button", { name: "Watch", exact: true }).click();
  await expect(page.getByRole("region", { name: /'s hand$/ })).toHaveCount(4);
  await helpButton(page).click();
  await expect(rules(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(helpButton(page)).toBeFocused();
});
