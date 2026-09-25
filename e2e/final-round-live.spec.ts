import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { card, makeCtx, rig, rigDeck, started } from "../src/lib/game/testkit";
import { projectPublic } from "../src/lib/game/view";
import type { Action, Card, GameState } from "../src/lib/game/types";

const origin = process.env.E2E_APP_ORIGIN!;
const restOrigin = process.env.E2E_REST_ORIGIN!;

async function rpc<T>(name: string, values: Record<string, unknown>): Promise<T> {
  if (!/^cambio-e2e-db-\d+$/.test(process.env.E2E_DB_CONTAINER ?? "")
    || !/^http:\/\/127\.0\.0\.1:\d+$/.test(restOrigin ?? "")) throw new Error("Run with the isolated test:accounts database.");
  const response = await fetch(`${restOrigin}/rpc/${name}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ p_secret: "account-test-secret", ...values }),
  });
  expect(response.ok, await response.clone().text()).toBe(true);
  return response.json() as Promise<T>;
}

async function liveTable(browser: Browser, hands: Card[][], draws: Card[]) {
  const ctx = makeCtx(37, Date.now() - 10_001);
  const fixture = started(ctx);
  const ids = fixture.ids;
  let state = fixture.state;
  hands.forEach((hand, seat) => { state = rig(state, ids[seat], hand); });
  state = rigDeck(state, draws.toReversed());
  state.code = randomBytes(3).toString("hex").slice(0, 5).toUpperCase();
  state.cards.top = card("top", "5");
  state.discard.push("top");
  state.log = [];
  state.reveals = [];
  state.openingPeekUntil = null;
  state.dealingUntil = null;
  // Hold the real clock only while all four browsers connect. Unanimous
  // resume below starts normal play, including the actual server watchdog.
  state.paused = true;
  state.pausedAt = Date.now();
  state.pausedBy = ids[0];
  state.turn!.startedAt = state.pausedAt;
  await rpc("game_create", { p_code: state.code, p_state: state, p_view: projectPublic(state, 1, Date.now()) });
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (const player of state.players) {
    const context = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const seat = { playerId: player.id, token: player.token!, name: player.name };
    await context.addInitScript(({ code, seat }) => {
      localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat));
      localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
    }, { code: state.code, seat });
    pages.push(await context.newPage());
  }
  await Promise.all(pages.map(async (page) => {
    await page.goto(`/g/${state.code}`);
    await expect(page.getByRole("region", { name: "Round actions", exact: true })).toBeVisible();
  }));
  const send = (seat: number, action: Action, actionId: string = randomUUID()) => contexts[seat].request.post(`/api/games/${state.code}/actions`, {
    headers: { origin, "x-cambio-token": state.players[seat].token! }, data: { actionId, action },
  });
  const act = async (seat: number, action: Action, actionId?: string) => {
    const response = await send(seat, action, actionId);
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const load = async () => (await rpc<{ state: GameState }[]>("game_load", { p_code: state.code }))[0].state;
  await act(0, { type: "pauseRequest" });
  for (const seat of [1, 2, 3]) await act(seat, { type: "pauseVote", agree: true });
  return { ids, pages, state, act, send, load, close: () => Promise.all(contexts.map((context) => context.close())) };
}

async function playTurn(page: Page) {
  const actions = page.getByRole("region", { name: "Round actions", exact: true });
  await actions.getByRole("button", { name: "Draw", exact: true }).click();
  const placed = page.waitForResponse((response) => response.url().endsWith("/actions")
    && response.request().postDataJSON()?.action?.type === "place");
  await actions.getByRole("button", { name: /^Place .* on the pile$/ }).click();
  expect((await placed).ok()).toBe(true);
}

async function results(table: Awaited<ReturnType<typeof liveTable>>, scores: number[]) {
  // A runner already sleeping for an earlier human turn rechecks within 12s;
  // allow that real scheduling bound as well as the 4s final reaction window.
  await expect.poll(async () => (await table.load()).phase, { timeout: 20_000 }).toBe("scoring");
  const state = await table.load();
  expect(state.results).toHaveLength(1);
  expect(state.results[0].scores.map((score) => score.score)).toEqual(scores);
  for (const page of table.pages) {
    const dialog = page.getByRole("dialog", { name: "Round results", exact: true });
    await expect(dialog).toBeVisible();
    for (let seat = 0; seat < 4; seat++) {
      const row = dialog.locator("tbody tr").filter({ hasText: table.state.players[seat].name });
      await expect(row.locator("td").nth(3)).toHaveText(String(scores[seat]));
    }
  }
  return state;
}

test("two zero players stay out while each remaining player gets exactly one live final turn", async ({ browser }) => {
  const table = await liveTable(browser, [
    [card("first-last", "5")], [card("give", "5"), card("eight", "8")],
    [card("second-last", "5")], [card("red", "K", "H"), card("queen", "Q"), card("black", "K"), card("joker", "JOKER", null)],
  ], [card("draw-1", "2"), card("draw-3", "2")]);
  try {
    await table.pages[0].getByRole("region", { name: "Host's hand", exact: true }).getByRole("button", { name: /^Stick this card/ }).click();
    await expect.poll(async () => (await table.load()).turn?.playerId).toBe(table.ids[1]);
    // Seat 2 reaches zero off turn, then receives the owed card. It remains out.
    await table.act(1, { type: "stick", cardId: "second-last" });
    await table.act(1, { type: "give", cardId: "give" });
    for (const seat of [0, 2]) {
      await expect(table.pages[seat].getByRole("region", { name: "Round actions" })).toContainText("You are out of this round.");
      expect((await table.send(seat, { type: "draw" })).status()).toBe(409);
      expect((await table.send(seat, { type: "stick", cardId: "give" })).status()).toBe(409);
      await expect(table.pages[seat].getByRole("button", { name: /^Stick this card/ })).toHaveCount(0);
    }
    await playTurn(table.pages[1]);
    await expect.poll(async () => (await table.load()).turn?.playerId).toBe(table.ids[3]);
    await playTurn(table.pages[3]);
    const final = await results(table, [0, 8, 5, 9]);
    expect(final.cambio?.callerId).toBe(table.ids[0]);
    expect(final.cambio?.zeroedIds).toEqual([table.ids[0], table.ids[2]]);
    expect(final.log.filter((entry) => entry.kind === "cambio")).toHaveLength(1);
    expect(final.log.filter((entry) => entry.kind === "draw").map((entry) => entry.actorId)).toEqual([table.ids[1], table.ids[3]]);
    await table.pages[0].screenshot({ path: "test-results/final-round-two-zero-players.png", fullPage: true, animations: "disabled" });
  } finally { await table.close(); }
});

test("a wrong stick on the final turn scores its penalty once and shows exact totals immediately", async ({ browser }) => {
  const table = await liveTable(browser, [
    [card("red", "K", "H")], [card("ace", "A"), card("queen", "Q"), card("joker", "JOKER", null)],
    [card("nine", "9"), card("jack", "J"), card("red-2", "K", "D")], [card("five", "5"), card("eight", "8")],
  ], [card("draw-1", "5"), card("draw-2", "5"), card("draw-3", "5"), card("penalty", "10")]);
  try {
    // Capture the first rendered totals, before any animation could settle.
    await table.pages[0].evaluate(() => {
      const observer = new MutationObserver(() => {
        const rows = document.querySelectorAll('[aria-label="Round results"] tbody tr');
        if (!rows.length) return;
        document.documentElement.dataset.firstScores = JSON.stringify(Array.from(rows, (row) => row.children[3].textContent));
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await table.act(0, { type: "callCambio" });
    await playTurn(table.pages[1]);
    await playTurn(table.pages[2]);
    await table.act(3, { type: "draw" });
    const actionId = randomUUID();
    await table.act(3, { type: "stick", cardId: "eight" }, actionId);
    await table.act(3, { type: "stick", cardId: "eight" }, actionId);
    await table.act(3, { type: "stick", cardId: "five" });
    await table.act(3, { type: "place" });
    const final = await results(table, [-1, 11, 18, 18]);
    expect(final.results[0].scores[3].cards.map((c) => c.id)).toEqual(["eight", "penalty"]);
    expect(final.results[0].tally?.[table.ids[3]]).toEqual({ sticks: 1, misses: 1 });
    expect(await table.pages[0].locator("html").getAttribute("data-first-scores")).toBe(JSON.stringify(["-1", "11", "18", "18"]));
    await table.pages[0].setViewportSize({ width: 390, height: 844 });
    const mobile = table.pages[0].getByRole("list", { name: "Final hands and scores" });
    for (let seat = 0; seat < 4; seat++) {
      const row = mobile.getByRole("listitem", { name: `${table.state.players[seat].name}'s result`, exact: true });
      await expect(row.getByText("Hand total").locator("..").locator("p").last()).toHaveText(String([-1, 11, 18, 18][seat]));
    }
    await table.pages[0].screenshot({ path: "test-results/final-round-penalty-mobile.png", fullPage: true, animations: "disabled" });
  } finally { await table.close(); }
});

test("concurrent wrong sticks in the last window preserve both penalties in the saved score", async ({ browser }) => {
  const table = await liveTable(browser, [
    [card("six", "6")], [card("seven", "7")], [card("eight", "8")], [card("nine", "9")],
  ], [card("draw-1", "2"), card("draw-2", "2"), card("draw-3", "5"), card("penalty-1", "10"), card("penalty-2", "K", "D")]);
  try {
    await table.act(0, { type: "callCambio" });
    for (const seat of [1, 2, 3]) {
      await table.act(seat, { type: "draw" });
      await table.act(seat, { type: "place" });
    }
    await Promise.all([table.act(1, { type: "stick", cardId: "seven" }), table.act(3, { type: "stick", cardId: "nine" })]);
    const current = await table.load();
    const firstGotTen = current.players[1].hand.includes("penalty-1");
    const final = await results(table, [6, firstGotTen ? 17 : 6, 8, firstGotTen ? 8 : 19]);
    expect(final.results[0].scores.reduce((sum, score) => sum + score.score, 0)).toBe(39);
    expect(final.results[0].scores.flatMap((score) => score.cards).filter((c) => c.id.startsWith("penalty-"))).toHaveLength(2);
  } finally { await table.close(); }
});

test("zero cancels a held draw and a later final-turn power without adding turns or penalty cards", async ({ browser }) => {
  const table = await liveTable(browser, [
    [card("first-last", "5")], [card("second-last", "J")],
    [card("three", "3"), card("four", "4")], [card("nine", "9")],
  ], [card("held", "5"), card("power", "J"), card("draw-2", "2"), card("draw-3", "2")]);
  try {
    await table.act(0, { type: "draw" });
    await table.act(0, { type: "stick", cardId: "first-last" });
    expect((await table.load()).discard.at(-1)).toBe("held");
    expect((await table.send(0, { type: "place" })).status()).toBe(409);
    await table.act(1, { type: "draw" });
    await table.act(1, { type: "place" });
    expect((await table.load()).pendingPower?.kind).toBe("blindSwap");
    await table.act(1, { type: "stick", cardId: "second-last" });
    expect((await table.load()).pendingPower).toBeNull();
    expect((await table.send(1, { type: "blindSwap", cardIdA: "three", cardIdB: "nine" })).status()).toBe(409);
    expect((await table.load()).turn?.playerId).toBe(table.ids[2]);
    await playTurn(table.pages[2]);
    await playTurn(table.pages[3]);
    const final = await results(table, [0, 0, 7, 9]);
    expect(final.cambio?.callerId).toBe(table.ids[0]);
    expect(final.cambio?.zeroedIds).toEqual(table.ids.slice(0, 2));
    expect(final.log.filter((entry) => entry.kind === "draw").map((entry) => entry.actorId)).toEqual(table.ids);
    expect(final.log.filter((entry) => entry.kind === "timeout" || entry.kind === "stickMiss")).toEqual([]);
  } finally { await table.close(); }
});
