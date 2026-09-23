import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { makeCtx, player, started, table } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const recentKey = "cambio:recent-table";
const post = (context: BrowserContext, path: string, data: unknown) => context.request.post(path, { headers: { origin }, data });
const recent = (page: Page) => page.getByRole("region", { name: "Recent table", exact: true });
const returned = (page: Page) => recent(page).getByRole("link", { name: "Return to table", exact: true });
const pointer = (page: Page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null") as { code: string; visitedAt: number } | null, recentKey);

async function openGuestTable(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("Display name", { exact: true }).fill(name);
  await page.getByRole("button", { name: "Open a table", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  const code = new URL(page.url()).pathname.split("/").at(-1)!;
  await expect.poll(async () => (await pointer(page))?.code).toBe(code);
  return code;
}

async function leave(page: Page) {
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await page.getByRole("dialog", { name: "Leave this table?", exact: true }).getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true })));
});

test("one latest table replaces the previous shortcut across tabs without background polling taking it back", async ({ page, context }) => {
  const first = await openGuestTable(page, "Recent Guest");
  const home = await context.newPage();
  const second = await context.newPage();
  try {
    await home.goto("/");
    await expect(returned(home)).toHaveAttribute("href", `/g/${first}`);
    const latest = await openGuestTable(second, "Recent Guest");
    await expect(returned(home)).toHaveAttribute("href", `/g/${latest}`);
    await expect(recent(home)).toHaveCount(1);
    await expect(home.getByRole("region", { name: "Your tables", exact: true })).toHaveCount(0);
    await expect(home.locator(`a[href="/g/${first}"]`)).toHaveCount(0);
    // The first table is still mounted and polling while another table is newer.
    await page.waitForResponse((response) => response.url().endsWith(`/api/games/${first}/state`), { timeout: 12_000 });
    expect((await pointer(home))?.code).toBe(latest);
    await expect(returned(home)).toHaveAttribute("href", `/g/${latest}`);
    await home.screenshot({ path: "test-results/recent-table-desktop.png", fullPage: true, animations: "disabled" });
  } finally { await home.close(); await second.close(); }
});

test("leaving a lobby releases the old seat but keeps a return path while a friend remains", async ({ page, context }) => {
  const code = await openGuestTable(page, "Returning Guest");
  const original = await page.evaluate((code) => JSON.parse(localStorage.getItem(`cambio:seat:${code}`)!), code);
  const friend = await post(context, `/api/games/${code}/join`, { name: "Still Here" });
  expect(friend.ok()).toBe(true);
  await leave(page);
  expect(await page.evaluate((code) => localStorage.getItem(`cambio:seat:${code}`), code)).toBeNull();
  await expect(returned(page)).toHaveAttribute("href", `/g/${code}`);
  await returned(page).click();
  const join = page.getByRole("form", { name: "Join table", exact: true });
  await expect(join).toBeVisible();
  await join.getByRole("button", { name: "Take a seat", exact: true }).click();
  await expect(join).toHaveCount(0);
  const replacement = await page.evaluate((code) => JSON.parse(localStorage.getItem(`cambio:seat:${code}`)!), code);
  expect(replacement.playerId).not.toBe(original.playerId);
  const state = await (await context.request.get(`/api/games/${code}/state`, { headers: { "x-cambio-token": replacement.token } })).json();
  expect(state.me).toBe(replacement.playerId);
  expect(state.view.public.players.map((seat: { name: string }) => seat.name).sort()).toEqual(["Returning Guest", "Still Here"]);
});

test("navigating home during a round preserves the guest seat until they explicitly leave", async ({ page }) => {
  const fixture = started(makeCtx(17, Date.now() - 10_001));
  const state = fixture.state;
  const me = player(state, fixture.hostId);
  const seat = { playerId: me.id, token: me.token!, name: me.name };
  const hand = [...me.hand];
  let leaveRequests = 0;
  await page.addInitScript(({ code, seat }) => localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat)), { code: state.code, seat });
  await page.route("**/api/account", (route) => route.fulfill({ json: { profile: null, username: null } }));
  await page.route(`**/api/games/${state.code}/state`, (route) => {
    const ownSeat = route.request().headers()["x-cambio-token"] === seat.token;
    const id = ownSeat ? me.id : null;
    return route.fulfill({ json: { view: projectFor(state, 1, id, Date.now()), me: id, seat: ownSeat ? seat : null } });
  });
  await page.route(`**/api/games/${state.code}/nudge`, (route) => route.fulfill({ json: { ok: true } }));
  await page.route(`**/api/games/${state.code}/actions`, (route) => {
    if (route.request().postDataJSON().action.type === "leaveTable") leaveRequests++;
    return route.fulfill({ json: { view: projectFor(state, 1, me.id, Date.now()), me: me.id, seat, note: null } });
  });
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await page.goto(`/g/${state.code}`);
  await expect(page.getByRole("region", { name: "Host's hand", exact: true })).toBeVisible();
  await expect.poll(async () => (await pointer(page))?.code).toBe(state.code);
  await page.getByRole("link", { name: "Cambio home", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  expect(await page.evaluate((code) => JSON.parse(localStorage.getItem(`cambio:seat:${code}`)!), state.code)).toEqual(seat);
  await expect(returned(page)).toHaveAttribute("href", `/g/${state.code}`);
  await returned(page).click();
  await expect(page.getByRole("region", { name: "Host's hand", exact: true }).getByRole("button")).toHaveCount(4);
  await expect(page.getByRole("region", { name: "Round actions", exact: true }).getByRole("button", { name: "Draw", exact: true })).toBeVisible();
  const restored = await page.evaluate(async ({ code, token }) => (await fetch(`/api/games/${code}/state`, { headers: { "x-cambio-token": token } })).json(), { code: state.code, token: seat.token });
  expect(restored.me).toBe(me.id);
  expect(restored.view.public.players.find((seat: { id: string }) => seat.id === me.id).hand).toEqual(hand);
  expect(leaveRequests).toBe(0);
});

test("unreturnable or unavailable latest tables disappear without falling back to older saved seats", async ({ page }) => {
  const fixture = table(makeCtx(18, Date.now()), 1);
  fixture.state.code = "LATST";
  const older = { code: "OLDER", playerId: "old-seat", token: "old-token", name: "Old Guest" };
  const requested: string[] = [];
  let mode: "open" | "full" | "playing" | "empty" | "missing" | "unavailable" = "open";
  await page.route("**/api/account", (route) => route.fulfill({ json: { profile: null, username: null } }));
  await page.route("**/api/games/*/state", (route) => {
    requested.push(route.request().url());
    if (mode === "missing") return route.fulfill({ status: 404, json: { error: { code: "NOT_FOUND", message: "No table with that code." } } });
    if (mode === "unavailable") return route.abort("failed");
    const state = mode === "full" ? table(makeCtx(19, Date.now()), 4).state
      : mode === "playing" ? started(makeCtx(20, Date.now() - 10_001), 4).state
        : structuredClone(fixture.state);
    state.code = fixture.state.code;
    if (mode === "empty") state.players = [];
    return route.fulfill({ json: { view: projectFor(state, 1, null, Date.now()), me: null, seat: null } });
  });
  await page.goto("/");
  await page.evaluate((older) => localStorage.setItem(`cambio:seat:${older.code}`, JSON.stringify(older)), older);
  for (const unavailable of ["full", "playing", "empty", "missing", "unavailable"] as const) {
    mode = "open";
    await page.evaluate(({ key, code }) => {
      localStorage.setItem(key, JSON.stringify({ code, visitedAt: Date.now() }));
      window.dispatchEvent(new StorageEvent("storage", { key }));
    }, { key: recentKey, code: fixture.state.code });
    await expect(returned(page)).toHaveAttribute("href", `/g/${fixture.state.code}`);
    mode = unavailable;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(recent(page)).toHaveCount(0);
    if (unavailable === "unavailable") expect((await pointer(page))?.code).toBe(fixture.state.code);
  }
  expect(requested.length).toBeGreaterThan(5);
  expect(requested.every((url) => url.endsWith(`/api/games/${fixture.state.code}/state`))).toBe(true);
  await expect(page.locator(`a[href="/g/${older.code}"]`)).toHaveCount(0);
});

test("home polling does not extend the recent visit and the shortcut expires after thirty minutes", async ({ page }) => {
  const fixture = table(makeCtx(21, Date.now()), 1);
  const visitedAt = Date.now() - 29 * 60_000;
  await page.addInitScript(({ key, code, visitedAt }) => localStorage.setItem(key, JSON.stringify({ code, visitedAt })), { key: recentKey, code: fixture.state.code, visitedAt });
  await page.route("**/api/account", (route) => route.fulfill({ json: { profile: null, username: null } }));
  await page.route(`**/api/games/${fixture.state.code}/state`, (route) => route.fulfill({ json: { view: projectFor(fixture.state, 1, null, Date.now()), me: null, seat: null } }));
  await page.goto("/");
  await expect(returned(page)).toBeVisible();
  await page.waitForResponse((response) => response.url().endsWith(`/api/games/${fixture.state.code}/state`), { timeout: 12_000 });
  expect((await pointer(page))?.visitedAt).toBe(visitedAt);
  await page.clock.setFixedTime(new Date(visitedAt + 30 * 60_000 + 1));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(recent(page)).toHaveCount(0);
  expect((await pointer(page))?.visitedAt).toBe(visitedAt);
});

test("signing out clears the shortcut and another account never inherits it", async ({ page, context }) => {
  const password = "Recent table account password 42!";
  const register = async (name: string) => {
    const response = await post(context, "/api/account", { username: `recent${randomBytes(4).toString("hex")}`, displayName: name, password });
    expect(response.status()).toBe(201);
  };
  await register("First Account");
  const first = await (await post(context, "/api/games", {})).json();
  await page.goto(`/g/${first.code}`);
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  await expect.poll(async () => (await pointer(page))?.code).toBe(first.code);
  await page.goto("/me");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect.poll(() => pointer(page)).toBeNull();
  await page.goto("/");
  await expect(recent(page)).toHaveCount(0);
  await register("Second Account");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Ready for a round?", exact: true })).toBeVisible();
  await expect(recent(page)).toHaveCount(0);
  expect(await pointer(page)).toBeNull();
  expect(await page.evaluate((code) => localStorage.getItem(`cambio:seat:${code}`), first.code)).toBeNull();
});
