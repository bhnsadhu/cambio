import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { act, card, makeCtx, player, rig, rigDeck, settleFinalTurns, started } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const password = "Layout test password 42!";
const post = (context: BrowserContext, path: string, data: unknown) => context.request.post(path, { headers: { origin }, data });

function sql(query: string) {
  const database = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(database)) throw new Error("Use the isolated test database.");
  return execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: query, encoding: "utf8" });
}

async function createAccount(context: BrowserContext, displayName: string) {
  const username = `layout${randomBytes(4).toString("hex")}`;
  const response = await post(context, "/api/account", { username, displayName, password });
  expect(response.status()).toBe(201);
  return { username, profile: (await response.json()).profile };
}

/** Check document and modal bounds, then retain real screenshots for visual review. */
async function audit(page: Page, screen: string, check?: (width: number) => Promise<void>) {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await page.locator("main button, main input, [role=dialog], [role=dialog] > div, [role=dialog] button").evaluateAll((elements) => elements.filter((element) => {
      if (!element.getClientRects().length) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1 || element.scrollWidth > element.clientWidth + 1;
    }).map((element) => ({ label: element.getAttribute("aria-label") ?? element.textContent?.slice(0, 80), width: element.clientWidth, content: element.scrollWidth })));
    expect(overflow, `${screen} at ${width}px`).toEqual([]);
    await check?.(width);
    if (width === 390 || width === 1440) await page.screenshot({ path: `test-results/layout/${screen}-${width}.png`, fullPage: true, animations: "disabled" });
  }
}

test("account and social screens retain aligned panels, readable rows, and safe insets", async ({ page, context, browser }) => {
  test.setTimeout(120_000);
  sql("delete from private.auth_limits;");
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await audit(page, "login");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await audit(page, "registration");

  const me = await createAccount(context, "Alexandria Collins");
  const friendContext = await browser.newContext({ baseURL: origin });
  const pendingContext = await browser.newContext({ baseURL: origin });
  try {
    const friend = await createAccount(friendContext, "Christopher Rivers");
    await post(context, "/api/social/friends", { username: friend.username });
    await post(friendContext, "/api/social/friends/respond", { profileId: me.profile.id, accept: true });
    await createAccount(pendingContext, "Maximilian Bennett");
    await post(pendingContext, "/api/social/friends", { username: me.username });
    sql(`update public.profiles set rounds_played = 42, rounds_won = 27, tables_played = 12, cambio_calls = 18, cambio_wins = 11, sticks_hit = 61, sticks_missed = 8, current_streak = 3, best_streak = 7 where id = '${me.profile.id}';
      update public.profiles set rounds_played = 24, rounds_won = 12 where id = '${friend.profile.id}';`);
    const friendSeat = await (await post(friendContext, "/api/games", { name: friend.profile.displayName })).json();
    const friendPage = await friendContext.newPage();
    await friendPage.addInitScript(() => localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true })));
    await friendPage.goto(`/g/${friendSeat.code}`);
    await expect(friendPage.getByRole("button", { name: "Start round", exact: true })).toBeVisible();

    await page.goto("/");
    const friends = page.getByRole("region", { name: "Friends", exact: true });
    await expect(friends.getByRole("link", { name: friend.profile.displayName, exact: true })).toBeVisible();
    await expect(friends.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
    await expect(friends.getByRole("button", { name: "Ask to join", exact: true })).toBeVisible({ timeout: 15_000 });
    await audit(page, "home", async (width) => {
      if (width >= 768) {
        const newTable = await page.getByRole("form", { name: "New table", exact: true }).boundingBox();
        const panel = await friends.boundingBox();
        expect(Math.abs(newTable!.y - panel!.y)).toBeLessThan(1);
        const heading = await page.getByRole("heading", { name: "New table", exact: true }).boundingBox();
        const friendHeading = await friends.getByRole("heading", { name: "Friends", exact: true }).boundingBox();
        expect(Math.abs(heading!.y - friendHeading!.y)).toBeLessThan(1);
      }
      const name = friends.getByRole("link", { name: friend.profile.displayName, exact: true });
      expect((await name.boundingBox())!.width).toBeGreaterThanOrEqual(100);
      const insets = await friends.locator("li").evaluateAll((rows) => rows.map((row) => Number.parseFloat(getComputedStyle(row).paddingRight)));
      expect(insets.every((inset) => inset >= 16)).toBe(true);
    });

    await page.goto(`/p/${me.username}`);
    await expect(page.getByRole("heading", { name: me.profile.displayName, exact: true })).toBeVisible();
    await expect(page.getByText(/Best hand|Average hand/)).toHaveCount(0);
    await audit(page, "profile");
    await page.goto("/leaderboard?scope=friends");
    await expect(page.getByRole("row", { name: "Your leaderboard row" })).toBeVisible();
    await audit(page, "leaderboard", async () => {
      const cell = page.getByRole("row", { name: "Your leaderboard row" }).locator('th[scope="row"]');
      expect((await cell.boundingBox())!.width).toBeGreaterThan(180);
      expect((await cell.locator("a > span").last().boundingBox())!.width).toBeGreaterThanOrEqual(100);
      expect(await cell.evaluate((element) => Number.parseFloat(getComputedStyle(element).paddingRight))).toBeGreaterThanOrEqual(20);
    });

    await page.goto("/me");
    await expect(page.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
    await audit(page, "account");
    await page.getByRole("button", { name: "Change password" }).click();
    await audit(page, "account-password");
    await page.getByRole("form", { name: "Password settings" }).getByRole("button", { name: "Cancel", exact: true }).click();
    await page.goto("/");
    await page.getByRole("button", { name: "Open a table", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "How Cambio works" })).toBeVisible();
    await audit(page, "walkthrough");
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
    await audit(page, "lobby");
    await page.getByRole("button", { name: "How to play", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "How to play", exact: true })).toBeVisible();
    await audit(page, "rules");
  } finally {
    await friendContext.close();
    await pendingContext.close();
  }
});

test("game and results keep long names, card positions, and trailing scores within their rows", async ({ page }) => {
  const ctx = makeCtx(3, Date.now() - 10_001);
  const initial = started(ctx);
  const { ids } = initial;
  let state = initial.state;
  const names = ["Alexandria Collins", "Christopher Rivers", "Maximilian Bennett", "Samantha Rodriguez"];
  for (const [seat, id] of ids.entries()) {
    state = rig(state, id, [card(`king-${seat}`, "K", "H"), card(`three-${seat}`, "3"), card(`five-${seat}`, "5"), card(`eight-${seat}`, "8")]);
    player(state, id).name = names[seat];
  }
  const me = ids[0];
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
  await page.route(`**/api/games/${state.code}/actions`, (route) => route.fulfill({ json: response() }));
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await page.goto(`/g/${state.code}`);
  await expect(page.getByRole("region", { name: `${names[0]}'s hand`, exact: true })).toBeVisible();
  await audit(page, "game");

  state = act(state, me, { type: "callCambio" }, ctx);
  for (const id of ids.slice(1)) {
    state = rigDeck(state, [card(`last-${id}`, "K", "H")]);
    state = act(state, id, { type: "draw" }, ctx);
    state = act(state, id, { type: "place" }, ctx);
  }
  state = act(state, me, { type: "stick", cardId: "king-0" }, ctx);
  state = settleFinalTurns(state, ctx);
  expect(state.phase).toBe("scoring");
  version++;
  await page.reload();
  const results = page.getByRole("dialog", { name: "Round results", exact: true });
  await expect(results).toBeVisible();
  await expect(results.locator("tbody tr").first().locator("td").nth(3)).toHaveText(String(Math.min(...state.results[0].scores.map((score) => score.score))));
  await expect(results.getByText(/Best hand|Average hand/)).toHaveCount(0);
  await audit(page, "results", async (width) => {
    if (width < 1024) {
      const ownResult = results.getByRole("listitem", { name: `${names[0]}'s result`, exact: true });
      await expect(ownResult.getByLabel("Card position 1", { exact: true })).toHaveCount(0);
      for (const slot of [2, 3, 4]) await expect(ownResult.getByLabel(`Card position ${slot}`, { exact: true })).toHaveText(String(slot));
    } else {
      const padding = await results.locator("tbody tr td:last-child").evaluateAll((cells) => cells.map((cell) => Number.parseFloat(getComputedStyle(cell).paddingRight)));
      expect(padding.every((value) => value >= 16)).toBe(true);
    }
  });
});
