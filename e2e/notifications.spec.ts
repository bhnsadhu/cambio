import { test, expect, type Locator, type Page } from "@playwright/test";
import { applyAction } from "../src/lib/game/engine";
import { card, makeCtx, player, rig, started } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";
import type { Action, EventKind, LogEntry } from "../src/lib/game/types";

const viewport = (page: Page) => page.getByRole("region", { name: "Notifications", exact: true });

async function appearance(notice: Locator) {
  await notice.evaluate(async (element) => { await Promise.all(element.getAnimations().map((animation) => animation.finished)); });
  return notice.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: box.x, y: box.y, width: box.width, background: style.backgroundColor, radius: style.borderRadius, border: style.borderColor };
  });
}

/** Game traffic is local and deterministic; no accounts or production writes. */
async function table(page: Page) {
  const ctx = makeCtx(7, Date.now() - 10_001);
  const initial = started(ctx);
  const me = initial.ids[0];
  let state = rig(initial.state, me, [card("match", "5"), card("miss", "3"), card("keep", "7")]);
  state.cards.pile = card("pile", "5");
  state.discard = ["pile"];
  if (state.turn) state.turn.startedAt = Date.now() + 600_000;
  let version = 1;
  let failure: string | null = null;
  const seat = { playerId: me, token: player(state, me).token!, name: player(state, me).name };
  const response = () => ({ view: projectFor(state, version, me, Date.now()), me, seat });
  await page.addInitScript(({ code, seat }) => {
    localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat));
    localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
  }, { code: state.code, seat });
  await page.route("**/api/account", (route) => route.fulfill({ json: { profile: null, username: null } }));
  await page.route(`**/api/games/${state.code}/state`, (route) => route.fulfill({ json: response() }));
  await page.route(`**/api/games/${state.code}/nudge`, (route) => route.fulfill({ json: { ok: true } }));
  await page.route(`**/api/games/${state.code}/actions`, (route) => {
    if (failure) return route.fulfill({ status: 409, json: { error: { code: "TEST", message: failure } } });
    const { action, actionId } = route.request().postDataJSON() as { action: Action; actionId: string };
    ctx.now = Date.now();
    const result = applyAction(state, { playerId: me, action, actionId }, ctx);
    state = result.state;
    if (state.turn) state.turn.startedAt = Date.now() + 600_000;
    version++;
    return route.fulfill({ json: { ...response(), note: result.note ?? null } });
  });
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await page.goto(`/g/${state.code}`);
  await expect(page.getByRole("region", { name: "Host's hand", exact: true })).toBeVisible();
  return {
    fail: (message: string) => { failure = message; },
    publish: (entries: Pick<LogEntry, "kind" | "text" | "weight">[]) => {
      for (const entry of entries) state.log.push({ ...entry, seq: ++state.logSeq, at: Date.now() });
      version++;
    },
  };
}

for (const width of [390, 1440]) {
  test(`sticks, game events, and action errors share one dark surface at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = await table(page);
    const notices = viewport(page);
    const event = notices.getByRole("region", { name: "Game event", exact: true });
    const hand = page.getByRole("region", { name: "Host's hand", exact: true });
    await hand.getByRole("button", { name: /^Stick this card/ }).first().click();
    await expect(event).toContainText("it is gone");
    await expect(notices.locator(".app-notification")).toHaveCount(1);
    const standard = await appearance(event);
    expect(standard.background).toBe("rgb(21, 21, 24)");
    expect(standard.radius).toBe("16px");
    expect(standard.x).toBeGreaterThanOrEqual(16);
    expect(standard.x + standard.width).toBeLessThanOrEqual(width - 16);
    expect(standard.y).toBe(await page.locator("[data-app-header]").evaluate((header) => (header as HTMLElement).offsetHeight + 12));
    await expect(event).toHaveAttribute("data-tone", "good");
    await page.screenshot({ path: `test-results/notifications/stick-${width}.png`, animations: "disabled" });
    await expect(event).toHaveCount(0);

    await hand.getByRole("button", { name: /^Stick this card/ }).first().click();
    await expect(event).toContainText("penalty card");
    await expect(notices.locator(".app-notification")).toHaveCount(1);
    expect(await appearance(event)).toEqual(standard);
    await expect(event).toHaveAttribute("data-tone", "bad");
    await expect(event).toHaveCount(0);

    // Every announceable event kind uses the same geometry, including major moments.
    const kinds: EventKind[] = ["table", "kick", "deal", "draw", "place", "swap", "peekOwn", "peekOther", "blindSwap", "kingLook", "kingSwap", "kingLeave", "skipPower", "give", "cambio", "zero", "timeout", "reshuffle", "roundEnd", "replay"];
    fixture.publish(kinds.map((kind) => ({ kind, text: `An event of kind ${kind}.`, weight: ["deal", "cambio", "zero", "roundEnd"].includes(kind) ? "loud" : "normal" })));
    for (const kind of kinds) {
      await expect(event).toContainText(`An event of kind ${kind}.`);
      expect(await appearance(event)).toEqual(standard);
      await expect(notices.locator(".app-notification")).toHaveCount(1);
    }
    await expect(event).toHaveCount(0);
    fixture.fail("That move is no longer available. Try again.");
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    const error = notices.getByRole("region", { name: "Cambio notification", exact: true });
    await expect(error.getByRole("alert")).toHaveText("That move is no longer available. Try again.");
    expect(await appearance(error)).toEqual(standard);
    await page.screenshot({ path: `test-results/notifications/error-${width}.png`, animations: "disabled" });
    await error.getByRole("button", { name: "Dismiss cambio notification" }).click();
    await expect(notices).toBeHidden();
  });
}

test("form feedback keeps its position, keyboard access, and reduced-motion treatment in a dialog", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/account", (route) => route.fulfill({ json: { profile: null, username: null } }));
  await page.route("**/api/games", (route) => route.fulfill({ status: 503, json: { error: { code: "TEST", message: "Tables are temporarily unavailable." } } }));
  await page.goto("/");
  await page.getByLabel("Display name", { exact: true }).fill("Guest");
  await page.getByRole("button", { name: "Open a table", exact: true }).click();
  const notice = viewport(page).getByRole("region", { name: "New table notification", exact: true });
  await expect(notice.getByRole("alert")).toHaveText("Tables are temporarily unavailable.");
  const baseline = await appearance(notice);
  await page.getByRole("button", { name: "Customize guest player", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Your guest player", exact: true });
  await expect(dialog.getByRole("region", { name: "Notifications", exact: true })).toBeVisible();
  expect(await appearance(notice)).toEqual(baseline);
  const dismiss = notice.getByRole("button", { name: "Dismiss new table notification" });
  await dismiss.focus();
  await expect(dismiss).toBeFocused();
  expect(await notice.evaluate((element) => getComputedStyle(element).animationName)).toBe("none");
  await page.screenshot({ path: "test-results/notifications/dialog-320.png", animations: "disabled" });
  await dismiss.press("Enter");
  await expect(notice).toHaveCount(0);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByRole("button", { name: "Open a table", exact: true }).click();
  await expect(notice).toBeVisible();
  await page.getByRole("link", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  await expect(viewport(page).locator(".app-notification")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
