import { test, expect, type Locator, type Page } from "@playwright/test";
import { act, card, makeCtx, player, rig, rigDeck, settleFinalTurns, started } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";
import type { GameState } from "../src/lib/game/types";

const editor = (page: Page) => page.getByRole("dialog", { name: "Your guest player", exact: true });

/** Keep the engine's public/private projection while delivering remote updates through polling. */
async function mockTable(page: Page, initial: GameState, me: string) {
  let state = initial;
  let version = 1;
  let servedVersion = 0;
  const seat = { playerId: me, token: player(state, me).token!, name: player(state, me).name };
  const response = () => ({ view: projectFor(state, version, me, Date.now()), me, seat, note: null });
  await page.addInitScript(({ code, seat }) => {
    localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat));
    localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
    // A returning seat can exist after its tab-scoped customization has expired.
    if (location.pathname === `/g/${code}`) sessionStorage.removeItem("cambio:guest-player");
  }, { code: state.code, seat });
  await page.route("**/api/account", (route) => route.fulfill({ json: { profile: null, username: null } }));
  await page.route(`**/api/games/${state.code}/state`, async (route) => {
    const delivered = version;
    await route.fulfill({ json: response() });
    servedVersion = delivered;
  });
  await page.route(`**/api/games/${state.code}/nudge`, (route) => route.fulfill({ json: { ok: true } }));
  await page.route(`**/api/games/${state.code}/actions`, (route) => route.fulfill({ json: response() }));
  await page.route(`**/api/games/${state.code}/profiles`, (route) => route.fulfill({ json: {
    profiles: state.players.filter((entry) => entry.profileId).map((entry) => ({ id: entry.profileId, handle: "tablefriend", points: 10 })),
  } }));
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await page.goto(`/g/${state.code}`);
  await expect(page.getByRole("region", { name: `${player(state, me).name}'s hand`, exact: true })).toBeVisible();
  return {
    seat,
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

for (const width of [390, 1440]) {
  test(`guest drafts and visible keyboard focus survive remote pause, resume, and scoring at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const ctx = makeCtx(3, Date.now() - 10_001);
    const initial = started(ctx);
    const { ids } = initial;
    const me = ids[0];
    let state = initial.state;
    for (const [index, id] of ids.entries()) {
      state = rig(state, id, [card(`king-${index}`, "K", "H"), card(`three-${index}`, "3"), card(`five-${index}`, "5"), card(`eight-${index}`, "8")]);
    }
    player(state, me).name = "Returning Guest";
    player(state, me).avatarId = 13;
    const table = await mockTable(page, state, me);
    await page.getByRole("button", { name: "Your guest player", exact: true }).click();
    const dialog = editor(page);
    const name = dialog.getByLabel("Display name", { exact: true });
    await name.fill("Unfinished Guest");
    await dialog.getByRole("radio", { name: "Ponytail", exact: true }).check();
    await dialog.getByRole("group", { name: "Skin tone", exact: true }).getByRole("radio", { name: "Deep", exact: true }).check();
    await name.focus();

    const changePause = async () => {
      state = act(state, ids[1], { type: "pauseRequest" }, ctx);
      for (const id of ids.filter((id) => id !== ids[1])) state = act(state, id, { type: "pauseVote", agree: true }, ctx);
      await table.publish(state);
    };
    const checkDraft = async () => {
      await expect(dialog).toBeVisible();
      await expect(name).toHaveValue("Unfinished Guest");
      await expect(dialog.getByRole("radio", { name: "Ponytail", exact: true })).toBeChecked();
      await expect(dialog.getByRole("group", { name: "Skin tone", exact: true }).getByRole("radio", { name: "Deep", exact: true })).toBeChecked();
      await expect(name).toBeFocused();
      await expectVisibleFocus(dialog);
      expect(player(state, me)).toMatchObject({ name: "Returning Guest", avatarId: 13 });
    };

    await changePause();
    await expect(page.getByRole("dialog", { name: "Table paused", exact: true })).toBeVisible();
    await checkDraft();
    await page.screenshot({ path: `test-results/guest-transitions/paused-draft-${width}.png`, fullPage: true, animations: "disabled" });
    ctx.tick(3000);
    await changePause();
    await expect(page.getByRole("dialog", { name: "Table paused", exact: true })).toHaveCount(0);
    await checkDraft();

    state = act(state, me, { type: "callCambio" }, ctx);
    for (const id of ids.slice(1)) {
      state = rigDeck(state, [card(`last-${id}`, "K", "H")]);
      state = act(state, id, { type: "draw" }, ctx);
      state = act(state, id, { type: "place" }, ctx);
    }
    state = settleFinalTurns(state, ctx);
    expect(state.phase).toBe("scoring");
    await table.publish(state);
    const results = page.getByRole("dialog", { name: "Round results", exact: true });
    await expect(results).toBeVisible();
    await checkDraft();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("link", { name: "Create an account", exact: true })).toBeFocused();
    await expectVisibleFocus(dialog);
    await page.keyboard.press("Tab");
    await expect(name).toBeFocused();
    await page.screenshot({ path: `test-results/guest-transitions/scoring-draft-${width}.png`, fullPage: true, animations: "disabled" });

    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expectVisibleFocus(results);
    await page.keyboard.press("Tab");
    await expectVisibleFocus(results);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test("returning guests keep their seat appearance when Add friend leads to signup", async ({ page }) => {
  const ctx = makeCtx(8, Date.now() - 10_001);
  const { state, ids } = started(ctx);
  const me = ids[0];
  player(state, me).name = "Returning Guest";
  player(state, me).avatarId = 13;
  player(state, ids[1]).name = "Table Friend";
  player(state, ids[1]).profileId = "00000000-0000-4000-8000-000000000001";
  const { seat } = await mockTable(page, state, me);
  await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem("cambio:guest-player") ?? "null")))
    .toEqual({ name: "Returning Guest", avatarId: 13 });
  const friend = page.getByRole("group", { name: "Table Friend's social details", exact: true });
  await friend.getByRole("link", { name: "Add friend", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/login\\?next=%2Fg%2F${state.code}$`));
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const form = page.getByRole("form", { name: "Create account", exact: true });
  await expect(form.getByLabel("Display name", { exact: true })).toHaveValue("Returning Guest");
  await form.getByLabel("Username", { exact: true }).fill("returningguest");
  await form.getByLabel("Password", { exact: true }).fill("Returning guest password 42!");
  await form.getByLabel("Confirm password", { exact: true }).fill("Returning guest password 42!");
  await page.route("**/api/account", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    // The live guest lifecycle suite exercises successful registration. Here
    // inspect the upgrade payload without inventing a server-side account.
    await route.fulfill({ status: 503, json: { error: { code: "SERVER", message: "Signup unavailable for this check." } } });
  });
  const registration = page.waitForRequest((request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/account");
  await form.getByRole("button", { name: "Create account", exact: true }).click();
  expect((await registration).postDataJSON()).toMatchObject({
    displayName: "Returning Guest", avatarId: 13, guestSeats: [{ code: state.code, token: seat.token }],
  });
  await expect(page.getByRole("region", { name: "Notifications", exact: true }).getByRole("alert")).toHaveText("Signup unavailable for this check.");
});
