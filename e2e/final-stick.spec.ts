import { test, expect, type Page } from "@playwright/test";
import { applyAction, STICK_WINDOW_MS } from "../src/lib/game/engine";
import { act, card, makeCtx, player, rig, rigDeck, started } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";
import type { Action, Rank } from "../src/lib/game/types";

/** Real rules and browser interactions, with an isolated in-memory API. */
async function finalTable(page: Page, rank: Rank = "5", viewerSeat = 3) {
  const ctx = makeCtx(1, Date.now() - 10_001);
  const table = started(ctx);
  const ids = table.ids;
  let state = table.state;
  for (const [seat, id] of ids.entries()) {
    const ranks: Rank[] = seat === 3 ? [rank, rank] : seat === 0 ? [rank, "2"] : ["3", "4"];
    state = rig(state, id, ranks.map((value, slot) => card(`seat-${seat}-slot-${slot}`, value)));
  }
  state = act(state, ids[0], { type: "callCambio" }, ctx);
  for (const id of [ids[1], ids[2]]) {
    state = rigDeck(state, [card(`preceding-${id}`, "K", "H")]);
    state = act(state, id, { type: "draw" }, ctx);
    state = act(state, id, { type: "place" }, ctx);
  }
  state = rigDeck(state, [card("final-card", rank)]);
  state = act(state, ids[3], { type: "draw" }, ctx);
  let version = 1;
  const me = ids[viewerSeat];
  const seat = { playerId: me, token: player(state, me).token!, name: player(state, me).name };
  const actions: Action[] = [];
  const apply = (who: string, action: Action, actionId = `test-${++version}`) => {
    ctx.now = Date.now();
    const result = applyAction(state, { playerId: who, action, actionId }, ctx);
    state = result.state;
    if (result.changed) version++;
    return result;
  };
  const response = () => ({ view: projectFor(state, version, me, Date.now()), me, seat });
  await page.addInitScript(({ code, seat }) => {
    localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat));
    localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
  }, { code: state.code, seat });
  await page.route("**/api/account", (route) => route.fulfill({ json: { profile: null, username: null } }));
  await page.route(`**/api/games/${state.code}/state`, (route) => route.fulfill({ json: response() }));
  await page.route(`**/api/games/${state.code}/nudge`, (route) => route.fulfill({ json: { ok: true } }));
  await page.route(`**/api/games/${state.code}/actions`, (route) => {
    const { action, actionId } = route.request().postDataJSON() as { action: Action; actionId: string };
    actions.push(action);
    const result = apply(me, action, actionId);
    return route.fulfill({ json: { ...response(), note: result.note ?? null } });
  });
  // Deliberately disable realtime so the independent HTTP fallback is covered.
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await page.goto(`/g/${state.code}`);
  const hand = page.getByRole("region", { name: `${seat.name}'s hand`, exact: true });
  await expect(hand).toBeVisible();
  return { actions, ids, me, hand, current: () => state, remotePlace: () => apply(ids[3], { type: "place" }) };
}

test("the final player sticks consecutive cards after placing the last card, before results open", async ({ page }) => {
  const fixture = await finalTable(page);
  const actions = page.getByRole("region", { name: "Round actions" });
  const results = page.getByRole("dialog", { name: "Round results", exact: true });
  await actions.getByRole("button", { name: /^Place .* on the pile$/ }).click();
  await expect(actions.getByText("Last call for sticks.", { exact: true })).toBeVisible();
  await expect(results).toHaveCount(0);
  // The pile must finish its 460ms flight while the reaction window is open.
  await expect(page.getByRole("region", { name: "Deck and discard pile" }).getByText("5", { exact: true })).toBeVisible();
  await fixture.hand.getByRole("button", { name: /^Stick this card/ }).first().click();
  await fixture.hand.getByRole("button", { name: /^Stick this card/ }).first().click();
  await expect(fixture.hand).toContainText("Out of cards");
  expect(fixture.current().phase).toBe("final");
  expect(fixture.actions.filter((action) => action.type === "stick")).toHaveLength(2);
  await expect(results).toBeVisible({ timeout: STICK_WINDOW_MS + 3_000 });
  expect(fixture.current().results[0].tally?.[fixture.me].sticks).toBe(2);
});

test("a matching card revealed by the final power remains clickable throughout the sticking window", async ({ page }) => {
  const fixture = await finalTable(page, "7");
  const actions = page.getByRole("region", { name: "Round actions" });
  await actions.getByRole("button", { name: /^Place .* on the pile$/ }).click();
  await fixture.hand.getByRole("button", { name: /^Peek this card/ }).first().click();
  await expect(actions.getByText("Last call for sticks.", { exact: true })).toBeVisible();
  const revealed = fixture.hand.locator('button[data-face="up"]');
  await expect(revealed).toBeVisible();
  await expect(revealed).toBeEnabled();
  await revealed.click();
  expect(fixture.current().phase).toBe("final");
  await expect.poll(() => fixture.current().tally[fixture.me]?.sticks).toBe(1);
  expect(fixture.actions.filter((action) => action.type === "stick")).toHaveLength(1);
});

test("fallback polling shows another player's final placement in time to stick", async ({ page }) => {
  const fixture = await finalTable(page, "5", 0);
  const actions = page.getByRole("region", { name: "Round actions" });
  fixture.remotePlace();
  await expect(actions.getByText("Last call for sticks.", { exact: true })).toBeVisible({ timeout: 2_500 });
  await fixture.hand.getByRole("button", { name: /^Stick this card/ }).first().click();
  await expect.poll(() => fixture.current().tally[fixture.me]?.sticks).toBe(1);
  expect(fixture.current().phase).toBe("final");
  expect(fixture.current().stickWindowUntil! - Date.now()).toBeGreaterThan(STICK_WINDOW_MS - 1_000);
});
