import { test, expect, type Locator, type Page } from "@playwright/test";
import { act, card, makeCtx, player, rig, rigDeck, settleFinalTurns, started } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";
import type { GameState } from "../src/lib/game/types";

/** Deliver remote engine transitions through the same polling path as a live table. */
async function mockTable(page: Page, initial: GameState, me: string | null) {
  let state = initial;
  let version = 1;
  let servedVersion = 0;
  const actions: string[] = [];
  const seat = me ? { playerId: me, token: player(state, me).token!, name: player(state, me).name } : null;
  const response = () => ({ view: projectFor(state, version, me, Date.now()), me, seat, note: null });
  await page.addInitScript(({ code, seat }) => {
    if (seat) localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat));
    localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
  }, { code: state.code, seat });
  await page.route("**/api/account", (route) => route.fulfill({ json: { profile: null, username: null } }));
  await page.route(`**/api/games/${state.code}/state`, async (route) => {
    const delivered = version;
    await route.fulfill({ json: response() });
    servedVersion = delivered;
  });
  await page.route(`**/api/games/${state.code}/nudge`, (route) => route.fulfill({ json: { ok: true } }));
  await page.route(`**/api/games/${state.code}/actions`, (route) => {
    actions.push(route.request().postDataJSON().action.type);
    return route.fulfill({ json: response() });
  });
  await page.route(`**/api/games/${state.code}/profiles`, (route) => route.fulfill({ json: { profiles: [] } }));
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await page.goto(`/g/${state.code}`);
  if (me) await expect(page.getByRole("region", { name: `${player(state, me).name}'s hand`, exact: true })).toBeVisible();
  else await page.getByRole("button", { name: "Watch", exact: true }).click();
  return {
    actions,
    async publish(next: GameState) {
      state = next;
      const expectedVersion = ++version;
      await expect.poll(() => servedVersion).toBeGreaterThanOrEqual(expectedVersion);
    },
  };
}

async function expectVisibleFocus(dialog: Locator) {
  await expect.poll(() => dialog.evaluate((element) => {
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !element.contains(focused)) return false;
    const rect = focused.getBoundingClientRect();
    const x = Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2));
    const y = Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2));
    const visible = document.elementFromPoint(x, y);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight
      && !!visible && element.contains(visible);
  })).toBe(true);
}

function agreeToPause(state: GameState, ids: string[], ctx: ReturnType<typeof makeCtx>) {
  for (const id of ids) {
    if (!state.pauseVote?.agreed.includes(id)) state = act(state, id, { type: "pauseVote", agree: true }, ctx);
  }
  return state;
}

for (const width of [390, 1440]) {
  test(`a late pause keeps keyboard focus in the visible leave confirmation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ctx = makeCtx(12, Date.now() - 10_001);
    const initial = started(ctx);
    let state = act(initial.state, initial.ids[1], { type: "pauseRequest" }, ctx);
    const table = await mockTable(page, state, initial.hostId);
    await page.getByRole("navigation", { name: "Table controls", exact: true }).getByRole("button", { name: "Leave", exact: true }).click();
    const leave = page.getByRole("dialog", { name: "Leave this table?", exact: true });
    const stay = leave.getByRole("button", { name: "Stay", exact: true });
    await stay.focus();

    state = agreeToPause(state, initial.ids, ctx);
    expect(state.paused).toBe(true);
    await table.publish(state);
    const pause = page.getByRole("dialog", { name: "Table paused", exact: true });
    await expect(pause).toBeVisible();
    // Pause mounts later, but the existing Leave sibling paints above it.
    await expect(stay).toBeFocused();
    await expectVisibleFocus(leave);
    await page.keyboard.press("Tab");
    await expect(leave.getByRole("button", { name: "Leave", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(stay).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(leave.getByRole("button", { name: "Leave", exact: true })).toBeFocused();
    await expectVisibleFocus(leave);

    await stay.click();
    await expect(leave).toHaveCount(0);
    await expectVisibleFocus(pause);
    // An equal-layer child dialog still owns focus over its pause parent.
    const playersButton = pause.getByRole("button", { name: "Players", exact: true });
    await playersButton.click();
    const players = page.getByRole("dialog", { name: "Table players", exact: true });
    await expectVisibleFocus(players);
    await page.keyboard.press("Shift+Tab");
    await expect(players.getByRole("button", { name: "Done", exact: true })).toBeFocused();
    await expectVisibleFocus(players);
    await page.keyboard.press("Escape");
    await expect(players).toHaveCount(0);
    await expect(playersButton).toBeFocused();
    await expectVisibleFocus(pause);

    await pause.getByRole("button", { name: "Leave table", exact: true }).click();
    await expectVisibleFocus(leave);
    await page.keyboard.press("Escape");
    await expect(leave).toHaveCount(0);
    await expect(pause.getByRole("button", { name: "Leave table", exact: true })).toBeFocused();
    await expectVisibleFocus(pause);
    expect(table.actions).toEqual([]);
    expect(errors).toEqual([]);
  });
}

for (const phase of ["paused", "scoring"] as const) {
  test(`spectators can go Home from ${phase} without acting on the table`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const ctx = makeCtx(14, Date.now() - 10_001);
    const initial = started(ctx);
    let state = initial.state;
    if (phase === "paused") {
      state = act(state, initial.hostId, { type: "pauseRequest" }, ctx);
      state = agreeToPause(state, initial.ids, ctx);
    } else {
      for (const [index, id] of initial.ids.entries()) {
        state = rig(state, id, [card(`king-${index}`, "K", "H"), card(`three-${index}`, "3"), card(`five-${index}`, "5"), card(`eight-${index}`, "8")]);
      }
      state = act(state, initial.hostId, { type: "callCambio" }, ctx);
      for (const id of initial.ids.slice(1)) {
        state = rigDeck(state, [card(`last-${id}`, "K", "H")]);
        state = act(state, id, { type: "draw" }, ctx);
        state = act(state, id, { type: "place" }, ctx);
      }
      state = settleFinalTurns(state, ctx);
      expect(state.phase).toBe("scoring");
    }
    const table = await mockTable(page, state, null);
    const dialog = page.getByRole("dialog", { name: phase === "paused" ? "Table paused" : "Round results", exact: true });
    const home = dialog.getByRole("link", { name: "Home", exact: true });
    await expect(home).toBeVisible();
    await expect(home).toHaveAttribute("href", "/");
    await page.keyboard.press("Tab");
    await expect(home).toBeFocused();
    await expectVisibleFocus(dialog);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/$/);
    expect(table.actions).toEqual([]);
  });
}
