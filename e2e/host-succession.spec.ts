import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import type { Action, PlayerView } from "../src/lib/game/types";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
type Seat = { playerId: string; token: string; name: string };
type Table = Seat & { code: string };
type StateResponse = { view: PlayerView; me: string | null };
const post = (context: BrowserContext, path: string, data: unknown, token?: string) => context.request.post(path, {
  headers: { origin, ...(token ? { "x-cambio-token": token } : {}) }, data,
});
const action = (context: BrowserContext, code: string, action: Action, token?: string) =>
  post(context, `/api/games/${code}/actions`, { actionId: crypto.randomUUID(), action }, token);
async function state(context: BrowserContext, code: string, token?: string): Promise<StateResponse> {
  const response = await context.request.get(`/api/games/${code}/state`, { headers: token ? { "x-cambio-token": token } : {} });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function takeAction(context: BrowserContext, code: string, data: Action, seat: Seat): Promise<StateResponse> {
  const response = await action(context, code, data, seat.token);
  const body = await response.json();
  expect(response.ok(), JSON.stringify(body)).toBe(true);
  return body;
}
async function openAs(page: Page, table: Table, seat: Seat) {
  await page.addInitScript(({ code, seat }) => {
    localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat));
    localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
  }, { code: table.code, seat });
  await page.goto(`/g/${table.code}`);
}

test("host succession follows arrival order after bot replacements, open seat reuse, and seat compaction", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  if (!/^cambio-e2e-db-\d+$/.test(process.env.E2E_DB_CONTAINER ?? "")) throw new Error("Use the isolated test database.");
  const secondContext = await browser.newContext({ baseURL: origin });
  const newcomerContext = await browser.newContext({ baseURL: origin });
  try {
    const created = await post(context, "/api/games", { name: "Original Host" });
    expect(created.ok()).toBe(true);
    const table: Table = { ...await created.json(), name: "Original Host" };
    const friends: Seat[] = [];
    for (const name of ["First Arrival", "Second Arrival", "Third Arrival"]) {
      const joined = await post(context, `/api/games/${table.code}/join`, { name });
      expect(joined.ok()).toBe(true);
      const { playerId, token } = await joined.json();
      friends.push({ playerId, token, name });
    }
    const [first, second, third] = friends;
    await openAs(page, table, first);
    await expect(page.getByRole("button", { name: "Players", exact: true })).toHaveCount(0);
    await takeAction(context, table.code, { type: "start" }, table);
    const before = (await state(context, table.code)).view.public;
    const originalHand = before.players.find((p) => p.id === table.playerId)!.hand;
    const departed = await takeAction(context, table.code, { type: "leaveTable" }, table);
    expect(departed.me).toBeNull();
    expect(departed.view.public).toMatchObject({ phase: "ready", hostId: first.playerId });
    expect(departed.view.public.players.find((p) => p.seat === 0)).toMatchObject({ isBot: true, isHost: false, difficulty: "medium", hand: originalHand });
    expect(departed.view.public.players.filter((p) => p.isHost).map((p) => p.id)).toEqual([first.playerId]);
    await expect(page.getByRole("button", { name: "Players", exact: true })).toBeVisible();
    expect((await action(context, table.code, { type: "setDoNotDisturb", enabled: true }, table.token)).status()).toBe(401);
    expect((await action(context, table.code, { type: "setDoNotDisturb", enabled: true }, second.token)).status()).toBe(409);
    await takeAction(context, table.code, { type: "setDoNotDisturb", enabled: true }, first);
    for (const friend of friends) await takeAction(context, table.code, { type: "ready" }, friend);

    // The replacement bot plays normally. Finish human turns through the API;
    // allow its own Cambio call or sticks without relying on a particular deal.
    await expect.poll(async () => {
      const current = (await state(context, table.code)).view.public;
      const debt = current.pendingGives.find((g) => friends.some((p) => p.playerId === g.from));
      const actorId = debt?.from ?? current.turn?.playerId;
      const actor = friends.find((p) => p.playerId === actorId);
      if (actor) {
        const ownCard = current.players.find((p) => p.id === actor.playerId)!.hand.find((id) => id !== null);
        if (debt && ownCard) await takeAction(context, table.code, { type: "give", cardId: ownCard }, actor);
        else if (current.phase === "playing" && current.turn?.stage === "draw") await takeAction(context, table.code, { type: "callCambio" }, actor);
        else if (current.phase === "final" && current.turn?.stage === "draw") await takeAction(context, table.code, { type: "draw" }, actor);
        else if (current.phase === "final" && current.turn?.stage === "decide" && ownCard) await takeAction(context, table.code, { type: "swap", cardId: ownCard }, actor);
      }
      return current.phase;
    }, { timeout: 55_000, intervals: [500, 1000] }).toBe("scoring");
    const scored = (await state(context, table.code)).view.public;
    await page.getByRole("dialog", { name: "Round results", exact: true }).getByRole("button", { name: "Back to table", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
    const lobby = (await state(context, table.code)).view.public;
    expect(lobby.players.map((p) => ({ id: p.id, seat: p.seat }))).toEqual(friends.map((p, index) => ({ id: p.playerId, seat: index + 1 })));
    expect(lobby.results).toEqual(scored.results);

    const joined = await post(newcomerContext, `/api/games/${table.code}/join`, { name: "Late Arrival" });
    expect(joined.ok()).toBe(true);
    const { playerId, token } = await joined.json();
    const newcomer: Seat = { playerId, token, name: "Late Arrival" };
    expect((await state(context, table.code)).view.public.players.find((p) => p.id === newcomer.playerId)?.seat).toBe(0);
    const secondPage = await secondContext.newPage();
    const newcomerPage = await newcomerContext.newPage();
    await openAs(secondPage, table, second);
    await openAs(newcomerPage, table, newcomer);
    await expect(secondPage.getByText("Waiting for First Arrival to start", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Leave", exact: true }).click();
    await page.getByRole("dialog", { name: "Leave this table?", exact: true }).getByRole("button", { name: "Leave", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    const inherited = (await state(context, table.code)).view.public;
    expect(inherited.hostId).toBe(second.playerId);
    expect(inherited.players.map((p) => ({ id: p.id, seat: p.seat, isHost: p.isHost }))).toEqual([
      { id: newcomer.playerId, seat: 0, isHost: false },
      { id: second.playerId, seat: 1, isHost: true },
      { id: third.playerId, seat: 2, isHost: false },
    ]);
    await expect(secondPage.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
    await expect(secondPage.getByRole("button", { name: "Players", exact: true })).toBeVisible();
    await expect(newcomerPage.getByText("Waiting for Second Arrival to start", { exact: true })).toBeVisible();
    await expect(newcomerPage.getByRole("button", { name: "Players", exact: true })).toHaveCount(0);
    expect((await action(newcomerContext, table.code, { type: "start" }, newcomer.token)).status()).toBe(409);
    expect((await action(context, table.code, { type: "start" }, first.token)).status()).toBe(401);
    await takeAction(secondContext, table.code, { type: "setDoNotDisturb", enabled: false }, second);

    // Starting another round sorts by seat again; a newer low seat must still
    // never outrank the remaining friend when this host leaves mid-round.
    await secondPage.getByRole("button", { name: "Start round", exact: true }).click();
    await expect.poll(async () => (await state(context, table.code)).view.public.phase).toBe("ready");
    const next = (await state(context, table.code)).view.public;
    const secondHand = next.players.find((p) => p.id === second.playerId)!.hand;
    const nextHost = await takeAction(secondContext, table.code, { type: "leaveTable" }, second);
    expect(nextHost.view.public).toMatchObject({ phase: "ready", round: 2, hostId: third.playerId, results: scored.results });
    expect(nextHost.view.public.players.find((p) => p.seat === 1)).toMatchObject({ isBot: true, isHost: false, difficulty: "medium", hand: secondHand });
    expect(nextHost.view.public.players.filter((p) => p.isHost).map((p) => p.id)).toEqual([third.playerId]);
    expect((await action(newcomerContext, table.code, { type: "setDoNotDisturb", enabled: true }, newcomer.token)).status()).toBe(409);
    await takeAction(context, table.code, { type: "setDoNotDisturb", enabled: true }, third);
  } finally {
    await secondContext.close();
    await newcomerContext.close();
  }
});
