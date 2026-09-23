import { test, expect, type BrowserContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const password = "Keep the same seat 42!";
const post = (context: BrowserContext, path: string, data: unknown, token?: string) => context.request.post(path, {
  headers: { origin, ...(token ? { "x-cambio-token": token } : {}) }, data,
});
const action = (context: BrowserContext, code: string, data: unknown, token?: string) =>
  post(context, `/api/games/${code}/actions`, { actionId: crypto.randomUUID(), action: data }, token);
async function register(context: BrowserContext, displayName: string) {
  const response = await post(context, "/api/account", { username: `seat${randomBytes(5).toString("hex")}`, displayName, password });
  expect(response.status()).toBe(201);
  return (await response.json()).profile;
}

test.beforeEach(() => {
  const database = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(database)) throw new Error("Use the isolated test database.");
  execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], { input: "delete from private.auth_limits;", encoding: "utf8" });
});

for (const midRound of [false, true]) test(`guest signup and avatar change retain one seat ${midRound ? "mid round" : "in the lobby"}`, async ({ browser, page, context }) => {
  const host = await browser.newContext({ baseURL: origin });
  try {
    await register(host, "Table Host");
    const table = await (await post(host, "/api/games", {})).json();
    await page.goto(`/g/${table.code}`);
    await page.getByRole("textbox", { name: "Display name", exact: true }).fill("Guest Friend");
    await page.getByRole("button", { name: "Take a seat", exact: true }).click();
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    const guest = await page.evaluate((code) => JSON.parse(localStorage.getItem(`cambio:seat:${code}`)!), table.code);
    const otherTab = await context.newPage();
    await otherTab.goto(`/g/${table.code}`);
    await expect(otherTab.getByText("Guest Friend", { exact: true })).toBeVisible();
    if (midRound) {
      expect((await action(host, table.code, { type: "start" })).ok()).toBe(true);
      await action(host, table.code, { type: "ready" });
      await action(context, table.code, { type: "ready" }, guest.token);
      await expect.poll(async () => (await (await host.request.get(`/api/games/${table.code}/state`)).json()).view.public.phase, { timeout: 20_000 }).toBe("playing");
      await action(host, table.code, { type: "pauseRequest" });
      await action(context, table.code, { type: "pauseVote", agree: true }, guest.token);
    }
    const before = (await (await host.request.get(`/api/games/${table.code}/state`)).json()).view.public;
    const guestBefore = before.players.find((p: { id: string }) => p.id === guest.playerId);
    await page.goto(`/login?mode=register&next=${encodeURIComponent(`/g/${table.code}`)}`);
    const form = page.getByRole("form", { name: "Create account", exact: true });
    await form.getByLabel("Username", { exact: true }).fill(`seat${randomBytes(5).toString("hex")}`);
    await form.getByLabel("Display name", { exact: true }).fill("Account Friend");
    await form.getByLabel("Password", { exact: true }).fill(password);
    await form.getByLabel("Confirm password", { exact: true }).fill(password);
    await form.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/g/${table.code}`);
    const profile = (await (await context.request.get("/api/account")).json()).profile;
    expect(profile.id).toBeTruthy();
    let state = await (await context.request.get(`/api/games/${table.code}/state`)).json();
    expect(state.me).toBe(guest.playerId);
    expect(state.view.public.players).toHaveLength(before.players.length);
    expect(state.view.public.players.find((p: { id: string }) => p.id === guest.playerId)).toMatchObject({
      name: "Account Friend", profileId: profile.id, hand: guestBefore.hand, seat: guestBefore.seat,
    });
    expect(state.view.public.phase).toBe(before.phase);
    // Both the signup tab and another open table tab keep the same credential.
    for (const tab of [page, otherTab]) {
      await expect.poll(() => tab.evaluate((code) => JSON.parse(localStorage.getItem(`cambio:seat:${code}`)!)?.playerId, table.code)).toBe(guest.playerId);
    }
    await page.goto(`/me?from=${encodeURIComponent(`/g/${table.code}`)}`);
    await page.getByRole("button", { name: "Change avatar", exact: true }).click();
    const editor = page.getByRole("form", { name: "Avatar settings", exact: true });
    await editor.locator('input[name="avatarId"]').nth(2).check();
    await editor.getByRole("group", { name: "Skin tone", exact: true }).getByRole("radio", { name: "Deep", exact: true }).check();
    await editor.getByRole("button", { name: "Save avatar", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole("link", { name: "Back to the table", exact: true }).click();
    state = await (await context.request.get(`/api/games/${table.code}/state`)).json();
    expect(state.me).toBe(guest.playerId);
    expect(state.view.public.players.filter((p: { profileId: string }) => p.profileId === profile.id)).toHaveLength(1);
    expect(state.view.public.players.find((p: { id: string }) => p.id === guest.playerId)).toMatchObject({ avatarId: 26, hand: guestBefore.hand });
    // Re-entering by code is a resume, including while the round is paused.
    const resumed = await (await post(context, `/api/games/${table.code}/join`, {}, guest.token)).json();
    expect(resumed.playerId).toBe(guest.playerId);
    expect(resumed.token).toBe(guest.token);
    expect((await (await host.request.get(`/api/games/${table.code}/state`)).json()).view.public.players).toHaveLength(before.players.length);
  } finally { await host.close(); }
});

test("host removes players with confirmation, and a removed account loses its seat", async ({ browser, page, context }) => {
  const friend = await browser.newContext({ baseURL: origin });
  const stranger = await browser.newContext({ baseURL: origin });
  try {
    await register(context, "Table Host");
    await register(friend, "Table Friend");
    const table = await (await post(context, "/api/games", {})).json();
    const joined = await (await post(friend, `/api/games/${table.code}/join`, {})).json();
    expect((await action(friend, table.code, { type: "kickPlayer", playerId: table.playerId })).status()).toBe(409);
    expect((await action(stranger, table.code, { type: "kickPlayer", playerId: joined.playerId })).status()).toBe(401);
    expect((await action(context, table.code, { type: "claimIdentity", token: joined.token, profileId: "forged", displayName: "Forged" })).status()).toBe(409);
    const friendPage = await friend.newPage();
    await friendPage.goto(`/g/${table.code}`);
    await friendPage.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(friendPage.getByRole("button", { name: "Players", exact: true })).toHaveCount(0);
    await page.goto(`/g/${table.code}`);
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await page.getByRole("button", { name: "Start round", exact: true }).click();
    await expect(page.getByRole("region", { name: "Table Friend's hand", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Players", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Table players", exact: true });
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/table-players-${width}.png`, animations: "disabled" });
    }
    await dialog.getByRole("button", { name: "Remove Table Friend", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Remove Table Friend?", exact: true });
    await expect(dialog).toContainText("ends the current round without scoring");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await (await context.request.get(`/api/games/${table.code}/state`)).json()).view.public.players).toHaveLength(4);
    await page.getByRole("button", { name: "Remove Table Friend", exact: true }).click();
    await page.getByRole("button", { name: "Remove player", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("No other players are seated.");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
    await expect(friendPage.getByRole("heading", { name: "You were removed from the table.", exact: true })).toBeVisible({ timeout: 15_000 });
    const state = await (await friend.request.get(`/api/games/${table.code}/state`, { headers: { "x-cambio-token": joined.token } })).json();
    expect(state.me).toBeNull();
    expect(state.view.private).toBeNull();
    expect(state.view.public.results).toHaveLength(0);
    expect(state.view.public.players.map((p: { id: string }) => p.id)).toEqual([table.playerId]);
    expect((await action(friend, table.code, { type: "ready" }, joined.token)).status()).toBe(401);
  } finally { await friend.close(); await stranger.close(); }
});

test("guest hosts can remove guests and saved guest joins resume instead of duplicating", async ({ page, context }) => {
  const host = await (await post(context, "/api/games", { name: "Guest Host" })).json();
  const guest = await (await post(context, `/api/games/${host.code}/join`, { name: "Guest Friend" })).json();
  const resumed = await (await post(context, `/api/games/${host.code}/join`, { name: "Guest Friend" }, guest.token)).json();
  expect(resumed.playerId).toBe(guest.playerId);
  await page.addInitScript(({ code, playerId, token }) => {
    localStorage.setItem(`cambio:seat:${code}`, JSON.stringify({ playerId, token, name: "Guest Host" }));
  }, host);
  await page.goto(`/g/${host.code}`);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await action(context, host.code, { type: "start" }, host.token);
  await action(context, host.code, { type: "ready" }, host.token);
  await action(context, host.code, { type: "ready" }, guest.token);
  await expect.poll(async () => (await (await context.request.get(`/api/games/${host.code}/state`)).json()).view.public.phase, { timeout: 20_000 }).toBe("playing");
  await action(context, host.code, { type: "pauseRequest" }, host.token);
  await action(context, host.code, { type: "pauseVote", agree: true }, guest.token);
  await expect(page.getByRole("dialog", { name: "Table paused", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Players", exact: true }).click();
  await page.getByRole("button", { name: "Remove Guest Friend", exact: true }).click();
  await page.getByRole("button", { name: "Remove player", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Table paused", exact: true })).toHaveCount(0);
  expect((await action(context, host.code, { type: "start" }, guest.token)).status()).toBe(401);
});
