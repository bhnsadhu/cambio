import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const editor = (page: Page) => page.getByRole("dialog", { name: "Your guest player", exact: true });
const post = (context: BrowserContext, path: string, data: unknown) => context.request.post(path, { headers: { origin }, data });
const publicState = async (context: BrowserContext, code: string) => (await (await context.request.get(`/api/games/${code}/state`)).json()).view.public;

test.beforeEach(() => {
  const database = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(database)) throw new Error("Use the isolated test database.");
  execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], { input: "delete from private.auth_limits;", encoding: "utf8" });
});

async function appearance(page: Page, name: string, style: string, tone: string) {
  await editor(page).getByLabel("Display name", { exact: true }).fill(name);
  await editor(page).getByRole("radio", { name: style, exact: true }).check();
  await editor(page).getByRole("group", { name: "Skin tone", exact: true }).getByRole("radio", { name: tone, exact: true }).check();
}

async function audit(page: Page, stage: string) {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await page.locator('main button, main input, [role="dialog"] > div, [role="dialog"] button').evaluateAll((items) => items.filter((item) => {
      if (!item.getClientRects().length) return false;
      const rect = item.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1 || item.scrollWidth > item.clientWidth + 1;
    }).map((item) => item.textContent));
    expect(overflow, `${stage} at ${width}px`).toEqual([]);
    if (width !== 320) await page.screenshot({ path: `test-results/guest-player/${stage}-${width}.png`, fullPage: true, animations: "disabled" });
  }
}

test("guest customization stays on the same seat, works while paused, shows table stats, and carries into signup", async ({ page, context }) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true })));
  await page.goto("/");
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Guest");
  await expect(page.getByRole("button", { name: "Open a table", exact: true })).toBeEnabled();
  await audit(page, "home");
  await page.getByRole("button", { name: "Customize guest player", exact: true }).click();
  await appearance(page, "Guest Designer", "Ponytail", "Very deep");
  await audit(page, "editor");
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Display name", { exact: true })).toHaveValue("Guest Designer");
  await expect(page.getByRole("button", { name: "Customize guest player", exact: true }).locator("[data-avatar-index]")).toHaveAttribute("data-avatar-index", "35");
  expect(await page.evaluate(() => localStorage.getItem("cambio:guest-player"))).toBeNull();
  expect((await (await context.request.get("/api/account")).json()).profile).toBeNull();
  await page.getByRole("button", { name: "Open a table", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  const code = page.url().split("/").at(-1)!;
  const initial = await publicState(context, code);
  const me = initial.players[0].id;
  expect(initial.players[0]).toMatchObject({ name: "Guest Designer", avatarId: 35, profileId: null });
  const preference = page.getByRole("switch", { name: "Do not disturb", exact: true });
  await preference.click(); await expect(preference).toBeChecked();
  await preference.click(); await expect(preference).not.toBeChecked();
  await page.getByRole("button", { name: "Start round", exact: true }).click();
  const actions = page.getByRole("region", { name: "Round actions", exact: true });
  await actions.getByRole("button", { name: "I'm ready", exact: true }).click();
  await expect.poll(async () => (await publicState(context, code)).phase, { timeout: 20_000 }).toBe("playing");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = page.getByRole("dialog", { name: "Table paused", exact: true });
  await expect(paused).toBeVisible();
  const before = await publicState(context, code);
  await paused.getByRole("button", { name: "Your guest player", exact: true }).click();
  await appearance(page, "Studio Guest", "Silver", "Medium");
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  const after = await publicState(context, code);
  expect(after.players.find((player: { id: string }) => player.id === me)).toMatchObject({ id: me, name: "Studio Guest", avatarId: 22, profileId: null });
  expect(after.players.map((player: { hand: string[] }) => player.hand)).toEqual(before.players.map((player: { hand: string[] }) => player.hand));
  expect(after.turn).toEqual(before.turn);
  expect(after.pausedAt).toBe(before.pausedAt);

  await paused.getByRole("button", { name: "Your guest player", exact: true }).click();
  await appearance(page, "Canceled Guest", "Bob", "Deep");
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await publicState(context, code)).players.find((player: { id: string }) => player.id === me).name).toBe("Studio Guest");
  await paused.getByRole("button", { name: "Your guest player", exact: true }).click();
  await appearance(page, "Failed Guest", "Bob", "Deep");
  await page.route(`**/api/games/${code}/actions`, (route) => route.fulfill({ status: 503, json: { error: { code: "SERVER", message: "Try again." } } }));
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toBeVisible();
  expect((await publicState(context, code)).players.find((player: { id: string }) => player.id === me).avatarId).toBe(22);
  await page.unroute(`**/api/games/${code}/actions`);
  await editor(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await paused.getByRole("button", { name: "Ask to resume", exact: true }).click();
  await expect(paused).toHaveCount(0);
  await page.getByRole("button", { name: "Your guest player", exact: true }).click();
  await appearance(page, "Studio Guest", "Curls", "Light");
  await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
  await expect(page.getByRole("region", { name: "Studio Guest's hand", exact: true }).locator("[data-avatar-index]")).toHaveAttribute("data-avatar-index", "7");
  await audit(page, "playing");
  const positions = await page.getByRole("region", { name: /'s hand$/ }).evaluateAll((hands) => hands.map((hand) => hand.querySelector('button[aria-label*="position 1"]')!.getBoundingClientRect().top));
  expect(Math.max(...positions) - Math.min(...positions)).toBeLessThan(1);
  await actions.getByRole("button", { name: "Call Cambio", exact: true }).click();
  const results = page.getByRole("dialog", { name: "Round results", exact: true });
  await expect(results).toBeVisible({ timeout: 60_000 });
  const scored = await publicState(context, code);
  const score = scored.results[0].scores.find((entry: { playerId: string }) => entry.playerId === me).score;
  await results.getByRole("button", { name: "Back to table", exact: true }).click();
  await page.getByRole("button", { name: "Your guest player", exact: true }).click();
  const stats = editor(page).getByRole("region", { name: "Your stats at this table", exact: true });
  await expect(stats.locator("dl > div").filter({ hasText: "Completed rounds" }).locator("dd")).toHaveText("1");
  await expect(stats.locator("dl > div").filter({ hasText: "Best hand" }).locator("dd")).toHaveText(String(score));
  await audit(page, "table-stats");
  await editor(page).getByRole("link", { name: "Create an account", exact: true }).click();
  const form = page.getByRole("form", { name: "Create account", exact: true });
  await expect(form.getByLabel("Display name", { exact: true })).toHaveValue("Studio Guest");
  await form.getByLabel("Username", { exact: true }).fill(`guest${randomBytes(5).toString("hex")}`);
  await form.getByLabel("Password", { exact: true }).fill("Guest upgrade password 42!");
  await form.getByLabel("Confirm password", { exact: true }).fill("Guest upgrade password 42!");
  await form.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/g/${code}`);
  await expect(page.getByRole("link", { name: "Account settings", exact: true })).toBeVisible();
  const account = (await (await context.request.get("/api/account")).json()).profile;
  expect(account).toMatchObject({ displayName: "Studio Guest", avatarId: 7, roundsPlayed: 0 });
  const upgraded = await publicState(context, code);
  expect(upgraded.players).toHaveLength(1);
  expect(upgraded.players[0]).toMatchObject({ id: me, profileId: account.id, avatarId: 7, isHost: true });
  expect(await page.evaluate(() => sessionStorage.getItem("cambio:guest-player"))).toBeNull();
  expect(errors).toEqual([]);
});

test("shared-code guests customize before joining without submitting the table form, and other tabs start fresh", async ({ page, context, browser }) => {
  const host = await browser.newContext({ baseURL: origin });
  try {
    const table = await (await post(host, "/api/games", { name: "Guest Host" })).json();
    await page.addInitScript(() => localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true })));
    await page.goto(`/g/${table.code}`);
    await page.getByRole("button", { name: "Customize guest player", exact: true }).click();
    await appearance(page, "Invited Guest", "Close crop", "Deep");
    await editor(page).getByRole("button", { name: "Apply changes", exact: true }).click();
    await expect(page.getByRole("button", { name: "Take a seat", exact: true })).toBeVisible();
    expect((await publicState(context, table.code)).players).toHaveLength(1);
    await page.getByRole("button", { name: "Take a seat", exact: true }).click();
    await expect(page.getByRole("button", { name: "Your guest player", exact: true })).toBeVisible();
    const joined = (await publicState(context, table.code)).players.find((player: { name: string }) => player.name === "Invited Guest");
    expect(joined).toMatchObject({ avatarId: 26, profileId: null });
    const otherTab = await context.newPage();
    await otherTab.goto("/");
    await expect(otherTab.getByLabel("Display name", { exact: true })).toHaveValue("Guest");
    expect(await otherTab.evaluate(() => sessionStorage.getItem("cambio:guest-player"))).toBeNull();
    await otherTab.getByLabel("Display name", { exact: true }).fill("Another Guest");
    await otherTab.getByRole("link", { name: "Log in", exact: true }).click();
    await otherTab.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(otherTab.getByRole("form", { name: "Create account", exact: true }).getByLabel("Display name", { exact: true })).toHaveValue("Another Guest");
    await otherTab.close();
  } finally { await host.close(); }
});
