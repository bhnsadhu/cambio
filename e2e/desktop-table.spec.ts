import { test, expect, type Locator, type Page } from "@playwright/test";
import { applyAction } from "../src/lib/game/engine";
import { act, card, makeCtx, player, rig, rigDeck, started } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";
import type { Action } from "../src/lib/game/types";

const laptopSizes = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
];

async function withinViewport(locator: Locator) {
  const bounds = await locator.boundingBox();
  expect(bounds).not.toBeNull();
  const viewport = locator.page().viewportSize()!;
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
}

async function laptopCanvas(page: Page, label: string) {
  for (const size of laptopSizes) {
    await page.setViewportSize(size);
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const hands = page.getByRole("region", { name: /'s hand$/ });
    await expect(hands).toHaveCount(4);
    for (const hand of await hands.all()) await withinViewport(hand);
    const actions = page.getByRole("region", { name: "Round actions", exact: true });
    const piles = page.getByRole("region", { name: "Deck and discard pile", exact: true });
    const log = page.getByRole("complementary", { name: "Table log", exact: true });
    await withinViewport(actions);
    await withinViewport(piles);
    await withinViewport(log);
    const lastHand = (await hands.last().boundingBox())!;
    const deck = (await piles.boundingBox())!;
    const history = (await log.boundingBox())!;
    expect(deck.x).toBeGreaterThan(lastHand.x + lastHand.width);
    expect(history.y).toBeGreaterThan(deck.y + deck.height);
    if (size.width === 1366) {
      await expect.poll(() => page.locator("[data-avatar-index] img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
      await expect(page.locator(".pointer-events-none.fixed.inset-0.z-40 > div")).toHaveCount(0);
      await page.screenshot({ path: `test-results/desktop/table-${label}-1366.png`, fullPage: true, animations: "disabled" });
    }
  }
}

test("laptop browsers keep hands, piles, activity, and turn actions together through card decisions", async ({ page }) => {
  const ctx = makeCtx(3, Date.now() - 10_001);
  const initial = started(ctx);
  let state = initial.state;
  const names = ["Alexandria Collins", "Christopher Rivers", "Maximilian Bennett", "Samantha Rodriguez"];
  for (const [seatIndex, id] of initial.ids.entries()) {
    state = rig(state, id, [card(`seven-${seatIndex}`, "7"), card(`three-${seatIndex}`, "3"), card(`five-${seatIndex}`, "5"), card(`eight-${seatIndex}`, "8")]);
    player(state, id).name = names[seatIndex];
  }
  state = rigDeck(state, [card("drawn-seven", "7")]);
  const me = initial.ids[0];
  const seat = { playerId: me, token: player(state, me).token!, name: names[0] };
  let version = 1;
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
    ctx.now = Date.now();
    const result = applyAction(state, { playerId: me, action, actionId }, ctx);
    state = result.state;
    version++;
    return route.fulfill({ json: { ...response(), note: result.note ?? null } });
  });
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await page.goto(`/g/${state.code}`);
  const actions = page.getByRole("region", { name: "Round actions", exact: true });
  await expect(actions.getByRole("button", { name: "Draw", exact: true })).toBeVisible();
  await laptopCanvas(page, "draw");
  await actions.getByRole("button", { name: "Draw", exact: true }).click();
  await expect(actions.getByRole("button", { name: /^Place .* on the pile$/ })).toBeVisible();
  await laptopCanvas(page, "decision");
  await actions.getByRole("button", { name: /^Place .* on the pile$/ }).click();
  await expect(actions.getByRole("button", { name: "Skip the power", exact: true })).toBeVisible();
  await laptopCanvas(page, "power");

  await page.getByRole("button", { name: "How to play", exact: true }).click();
  const rules = page.getByRole("dialog", { name: "How to play", exact: true });
  const reference = rules.locator("aside");
  await withinViewport(reference);
  expect((await reference.boundingBox())!.width).toBeGreaterThan(800);
  await rules.getByRole("button", { name: "Show walkthrough again", exact: true }).click();
  const walkthrough = page.getByRole("dialog", { name: "How Cambio works", exact: true });
  await withinViewport(walkthrough.locator(":scope > div"));
  expect((await walkthrough.locator(":scope > div").boundingBox())!.width).toBeGreaterThan(800);
  await walkthrough.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  const leave = page.getByRole("dialog", { name: "Leave this table?", exact: true });
  await expect(leave).toBeVisible();
  await expect(leave).toContainText("The round keeps going after you leave");
  await page.keyboard.press("Escape");
  await expect(leave).toHaveCount(0);
  await expect(actions.getByRole("button", { name: "Skip the power", exact: true })).toBeVisible();

  // A pause vote can arrive while the black king is revealing two cards.
  // Both notices must remain between the hands and the one set of decisions.
  state = started(makeCtx(9, Date.now() - 10_001)).state;
  for (const [index, id] of initial.ids.entries()) player(state, id).name = names[index];
  ctx.now = Date.now();
  state = rigDeck(state, [card("desktop-black-king", "K", "S")]);
  state = act(state, me, { type: "draw" }, ctx);
  state = act(state, me, { type: "place" }, ctx);
  state = act(state, me, { type: "kingLook", cardIdA: player(state, me).hand[0]!, cardIdB: player(state, initial.ids[1]).hand[0]! }, ctx);
  state = act(state, initial.ids[1], { type: "pauseRequest" }, ctx);
  version++;
  await page.reload();
  const vote = page.getByText("Pause requested", { exact: true }).locator("..").locator("..");
  const reveal = page.getByText("Two cards. Your call.", { exact: true }).locator("..").locator("..").locator("..");
  await expect(vote).toBeVisible();
  await expect(reveal).toBeVisible();
  await expect(page.getByRole("button", { name: "Swap them", exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Leave them", exact: true })).toHaveCount(1);
  for (const size of laptopSizes) {
    await page.setViewportSize(size);
    await page.evaluate(() => scrollTo(0, 0));
    const hands = await page.getByRole("region", { name: /'s hand$/ }).all();
    const handBottom = Math.max(...await Promise.all(hands.map(async (hand) => { const rect = (await hand.boundingBox())!; return rect.y + rect.height; })));
    const pauseBounds = (await vote.boundingBox())!;
    const revealBounds = (await reveal.boundingBox())!;
    const actionsBounds = (await actions.boundingBox())!;
    expect(pauseBounds.y).toBeGreaterThanOrEqual(handBottom + 8);
    expect(revealBounds.y).toBeGreaterThanOrEqual(pauseBounds.y + pauseBounds.height + 8);
    expect(actionsBounds.y).toBeGreaterThanOrEqual(revealBounds.y + revealBounds.height + 8);
    await actions.scrollIntoViewIfNeeded();
    await withinViewport(actions);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await actions.getByRole("button", { name: "Leave them", exact: true }).click();
  await expect(page.getByText("Two cards. Your call.", { exact: true })).toHaveCount(0);
  // Return to an actionable own-card power for the large-hand accessibility check.
  state = started(makeCtx(10, Date.now() - 10_001)).state;
  for (const [index, id] of initial.ids.entries()) player(state, id).name = names[index];
  state = rigDeck(state, [card("desktop-penalty-peek", "7")]);
  state = act(state, me, { type: "draw" }, ctx);
  state = act(state, me, { type: "place" }, ctx);

  // Penalty hands may need vertical scrolling, but every card and action stays reachable.
  state = rig(state, me, Array.from({ length: 8 }, (_, index) => card(`penalty-${index}`, "3")));
  version++;
  await page.reload();
  const hand = page.getByRole("region", { name: `${names[0]}'s hand`, exact: true });
  await expect(hand.getByRole("button")).toHaveCount(8);
  await hand.getByRole("button").last().scrollIntoViewIfNeeded();
  await withinViewport(hand.getByRole("button").last());
  await actions.scrollIntoViewIfNeeded();
  await withinViewport(actions);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
