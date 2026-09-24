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
    return { x: box.x, width: box.width, background: style.backgroundColor, radius: style.borderRadius, border: style.borderColor };
  });
}

async function centeredAtTable(page: Page) {
  const area = (await page.locator("[data-notification-area]").boundingBox())!;
  const stack = (await viewport(page).boundingBox())!;
  const actions = (await page.getByRole("region", { name: "Round actions", exact: true }).boundingBox())!;
  expect(Math.abs(stack.x + stack.width / 2 - area.x - area.width / 2)).toBeLessThan(1);
  expect(Math.abs(stack.y + stack.height / 2 - area.y - area.height / 2)).toBeLessThan(1);
  expect(stack.y).toBeGreaterThanOrEqual(area.y - 1);
  expect(stack.y + stack.height).toBeLessThanOrEqual(actions.y);
  expect(await viewport(page).evaluate((element) => ({ overflow: getComputedStyle(element).overflowY, clipped: element.scrollHeight > element.clientHeight + 1 }))).toEqual({ overflow: "visible", clipped: false });
  const hands = await page.getByRole("region", { name: /'s hand$/ }).all();
  for (const hand of hands) {
    const box = (await hand.boundingBox())!;
    expect(stack.y).toBeGreaterThanOrEqual(box.y + box.height);
  }
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
  test(`original notification treatments share the natural table flow at ${width}px`, async ({ page }) => {
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
    expect(standard.background).toBe("rgb(32, 32, 40)");
    expect(standard.radius).toBe(width >= 1024 ? "18px" : "24px");
    expect(standard.x).toBeGreaterThanOrEqual(16);
    expect(standard.x + standard.width).toBeLessThanOrEqual(width - 16);
    await centeredAtTable(page);
    await expect(event).toHaveAttribute("data-kind", "stick");
    await expect(event).toHaveAttribute("data-tone", "good");
    await notices.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/notifications/stick-${width}.png`, animations: "disabled" });
    await expect(event).toHaveCount(0);

    await hand.getByRole("button", { name: /^Stick this card/ }).first().click();
    await expect(event).toContainText("penalty card");
    await expect(notices.locator(".app-notification")).toHaveCount(1);
    expect(await appearance(event)).toEqual(standard);
    await centeredAtTable(page);
    await expect(event).toHaveAttribute("data-kind", "stick");
    await expect(event).toHaveAttribute("data-tone", "bad");
    await expect(event).toHaveCount(0);

    // Routine bars and larger major moments remain centered in the same area.
    const kinds: EventKind[] = ["table", "kick", "deal", "draw", "place", "swap", "peekOwn", "peekOther", "blindSwap", "kingLook", "kingSwap", "kingLeave", "skipPower", "give", "cambio", "zero", "timeout", "reshuffle", "roundEnd", "replay"];
    fixture.publish(kinds.map((kind) => ({ kind, text: `An event of kind ${kind}.`, weight: ["deal", "cambio", "zero", "roundEnd"].includes(kind) ? "loud" : "normal" })));
    for (const kind of kinds) {
      await expect(event).toContainText(`An event of kind ${kind}.`);
      const look = await appearance(event);
      if (["deal", "cambio", "zero", "roundEnd"].includes(kind)) {
        expect(look.radius).toBe(standard.radius);
        expect(look.width).toBe(Math.min(620, width < 1024 ? width - 40 : 620));
        expect(await event.locator(".t-title2").evaluate((element) => getComputedStyle(element).fontSize)).toBe("23px");
        if (kind === "cambio") {
          await notices.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `test-results/notifications/major-${width}.png`, animations: "disabled" });
        }
      } else expect(look).toEqual(standard);
      await centeredAtTable(page);
      await expect(event).toHaveAttribute("data-kind", "game");
      await expect(notices.locator(".app-notification")).toHaveCount(1);
    }
    await expect(event).toHaveCount(0);
    fixture.fail("That move is no longer available. Try again.");
    await page.getByRole("button", { name: "Draw", exact: true }).click();
    const error = notices.getByRole("region", { name: "Cambio notification", exact: true });
    await expect(error.getByRole("alert")).toHaveText("That move is no longer available. Try again.");
    expect(await appearance(error)).toEqual(standard);
    await centeredAtTable(page);
    await expect(error).toHaveAttribute("data-kind", "info");
    await notices.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/notifications/error-${width}.png`, animations: "disabled" });
    if (width === 1440) {
      const position = (await notices.boundingBox())!;
      await page.getByRole("button", { name: "Your guest player", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Your guest player", exact: true });
      await expect(dialog.getByRole("region", { name: "Notifications", exact: true })).toBeVisible();
      await expect.poll(() => notices.boundingBox()).toEqual(position);
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    await error.getByRole("button", { name: "Dismiss cambio notification" }).click();
    await expect(notices).toBeHidden();
    if (width === 1440) {
      await page.route("**/api/games", (route) => route.fulfill({ status: 503, json: { error: { code: "TEST", message: "Tables are temporarily unavailable." } } }));
      await page.getByRole("link", { name: "Cambio home", exact: true }).click();
      await page.getByLabel("Display name", { exact: true }).fill("Guest");
      await page.getByRole("button", { name: "Open a table", exact: true }).click();
      await expect(notices.getByRole("alert")).toHaveText("Tables are temporarily unavailable.");
      await expect(notices).toHaveAttribute("data-docked", "false");
      const position = (await notices.boundingBox())!;
      expect(position.x + position.width / 2).toBe(width / 2);
      expect(await notices.evaluate((element) => getComputedStyle(element).position)).toBe("sticky");
      await notices.scrollIntoViewIfNeeded();
      await expect(notices).toBeInViewport();
    }
  });
}

test("form feedback stays centered, accessible, and motion-safe in a dialog", async ({ page }) => {
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
  const position = (await notice.boundingBox())!;
  expect(position.x + position.width / 2).toBe(160);
  await notice.scrollIntoViewIfNeeded();
  await expect(notice).toBeInViewport();
  await page.getByRole("button", { name: "Customize guest player", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Your guest player", exact: true });
  await expect(dialog.getByRole("region", { name: "Notifications", exact: true })).toBeVisible();
  expect(await appearance(notice)).toEqual(baseline);
  const dialogPosition = (await notice.boundingBox())!;
  expect(dialogPosition.x + dialogPosition.width / 2).toBe(160);
  expect(dialogPosition.y + dialogPosition.height).toBe(740 - 24);
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
