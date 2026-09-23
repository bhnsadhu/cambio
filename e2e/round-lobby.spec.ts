import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import type { Action, PlayerView } from "../src/lib/game/types";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
type Seat = { playerId: string; token: string; name: string };
type Table = Seat & { code: string };
type StateResponse = { view: PlayerView; me: string | null; seat: Seat | null };
const post = (context: BrowserContext, path: string, data: unknown, token?: string) => context.request.post(path, {
  headers: { origin, ...(token ? { "x-cambio-token": token } : {}) }, data,
});
const action = (context: BrowserContext, code: string, action: Action, token?: string) =>
  post(context, `/api/games/${code}/actions`, { actionId: crypto.randomUUID(), action }, token);
const state = async (context: BrowserContext, code: string, token?: string): Promise<StateResponse> => {
  const response = await context.request.get(`/api/games/${code}/state`, { headers: token ? { "x-cambio-token": token } : {} });
  expect(response.ok()).toBe(true);
  return response.json();
};

async function takeAction(context: BrowserContext, code: string, data: Action, seat: Seat) {
  const response = await action(context, code, data, seat.token);
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
}

async function openAs(page: Page, table: Table, seat: Seat) {
  await page.addInitScript(({ code, seat }) => {
    localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat));
    localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
  }, { code: table.code, seat });
  await page.goto(`/g/${table.code}`);
}

test.beforeEach(() => {
  if (!/^cambio-e2e-db-\d+$/.test(process.env.E2E_DB_CONTAINER ?? "")) throw new Error("Use the isolated test database.");
});

for (const alreadyReady of [false, true]) test(`a nonhost brings everyone back to the same table ${alreadyReady ? "after voting for another round" : "straight from the results"}`, async ({ page, context, browser }) => {
  const friendContext = await browser.newContext({ baseURL: origin });
  const spectatorContext = await browser.newContext({ baseURL: origin });
  try {
    const created = await post(context, "/api/games", { name: "Round Host" });
    expect(created.ok()).toBe(true);
    const table: Table = { ...await created.json(), name: "Round Host" };
    const seats: Seat[] = [{ playerId: table.playerId, token: table.token, name: table.name }];
    for (const name of ["Returning Friend", "Third Friend", "Fourth Friend"]) {
      const joined = await post(context, `/api/games/${table.code}/join`, { name });
      expect(joined.ok()).toBe(true);
      const { playerId, token } = await joined.json();
      seats.push({ playerId, token, name });
    }
    await takeAction(context, table.code, { type: "start" }, table);
    for (const seat of seats) await takeAction(context, table.code, { type: "ready" }, seat);
    await expect.poll(async () => (await state(context, table.code)).view.public.phase, { timeout: 20_000 }).toBe("playing");
    await takeAction(context, table.code, { type: "callCambio" }, table);
    // Finish a real round through public actions, using swaps to avoid powers.
    for (const seat of seats.slice(1)) {
      const before = (await state(context, table.code)).view.public;
      expect(before.turn).toMatchObject({ playerId: seat.playerId, stage: "draw" });
      await takeAction(context, table.code, { type: "draw" }, seat);
      const cardId = before.players.find((p) => p.id === seat.playerId)!.hand.find((id) => id !== null)!;
      await takeAction(context, table.code, { type: "swap", cardId }, seat);
    }
    await expect.poll(async () => (await state(context, table.code)).view.public.phase, { timeout: 15_000 }).toBe("scoring");
    const scored = (await state(context, table.code)).view.public;
    expect(scored.results).toHaveLength(1);

    const friendPage = await friendContext.newPage();
    await openAs(page, table, seats[0]);
    await openAs(friendPage, table, seats[1]);
    const results = friendPage.getByRole("dialog", { name: "Round results", exact: true });
    await expect(results.getByRole("button", { name: "Back to table", exact: true })).toBeVisible();
    await expect(results.getByRole("button", { name: "I'm ready", exact: true })).toBeVisible();
    await expect(results.getByRole("button", { name: "Leave", exact: true })).toBeVisible();
    if (alreadyReady) {
      await results.getByRole("button", { name: "I'm ready", exact: true }).click();
      await expect(results).toContainText("You are ready for another round");
      await expect(results.getByRole("button", { name: "Back to table", exact: true })).toBeVisible();
      await expect(results.getByRole("button", { name: "Leave instead", exact: true })).toBeVisible();
    }
    for (const width of [390, 1440]) {
      await friendPage.setViewportSize({ width, height: 1000 });
      expect(await friendPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await friendPage.screenshot({ path: `test-results/round-lobby-${alreadyReady ? "ready" : "results"}-${width}.png`, animations: "disabled" });
    }

    const spectator = await spectatorContext.newPage();
    await spectator.addInitScript(() => localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true })));
    await spectator.goto(`/g/${table.code}`);
    await spectator.getByRole("button", { name: "Watch", exact: true }).click();
    await expect(spectator.getByRole("dialog", { name: "Round results", exact: true })).toBeVisible();
    await expect(spectator.getByRole("button", { name: "Back to table", exact: true })).toHaveCount(0);
    expect((await action(spectatorContext, table.code, { type: "returnToLobby" })).status()).toBe(401);

    await results.getByRole("button", { name: "Back to table", exact: true }).click();
    await expect(results).toHaveCount(0);
    await expect(page.getByRole("dialog", { name: "Round results", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
    await expect(friendPage.getByText("Waiting for Round Host to start", { exact: true })).toBeVisible();
    for (const [tab, seat] of [[page, seats[0]], [friendPage, seats[1]]] as const) {
      await expect(tab).toHaveURL(`${origin}/g/${table.code}`);
      expect(await tab.evaluate((code) => JSON.parse(localStorage.getItem(`cambio:seat:${code}`)!), table.code)).toEqual(seat);
      await expect(tab.getByText("4 of 4 seats taken", { exact: true })).toBeVisible();
    }
    const lobby = (await state(context, table.code, table.token)).view.public;
    expect(lobby).toMatchObject({ code: table.code, phase: "lobby", hostId: table.playerId, round: 1, replayVotes: [], results: scored.results });
    expect(lobby.players.map(({ id, seat, name, isHost }) => ({ id, seat, name, isHost }))).toEqual(scored.players.map(({ id, seat, name, isHost }) => ({ id, seat, name, isHost })));
    for (const seat of seats) expect((await state(context, table.code, seat.token)).me).toBe(seat.playerId);

    // A delayed second click is harmless, and the same host can deal round two.
    await takeAction(friendContext, table.code, { type: "returnToLobby" }, seats[1]);
    expect((await state(context, table.code)).view.public.version).toBe(lobby.version);
    await page.getByRole("button", { name: "Start round", exact: true }).click();
    await expect.poll(async () => (await state(context, table.code)).view.public.phase).toBe("ready");
    const next = (await state(context, table.code)).view.public;
    expect(next.round).toBe(2);
    expect(next.results).toEqual(scored.results);
    expect(next.players.map((p) => p.id)).toEqual(seats.map((s) => s.playerId));
    expect((await action(friendContext, table.code, { type: "returnToLobby" }, seats[1].token)).status()).toBe(409);
  } finally {
    await friendContext.close();
    await spectatorContext.close();
  }
});
