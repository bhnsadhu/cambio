import { test, expect, type Browser, type BrowserContext, type Page, type Route } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const password = "Table social test password 42!";
const post = (context: BrowserContext, path: string, data: unknown, token?: string) => context.request.post(path, {
  headers: { origin, ...(token ? { "x-cambio-token": token } : {}) }, data,
});
const action = (context: BrowserContext, code: string, data: unknown, token?: string) =>
  post(context, `/api/games/${code}/actions`, { actionId: randomUUID(), action: data }, token);

function sql(query: string) {
  const database = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(database)) throw new Error("Use the isolated test database.");
  return execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: query, encoding: "utf8" }).trim();
}

async function account(browser: Browser, displayName: string) {
  const context = await browser.newContext({ baseURL: origin });
  const username = `social${randomBytes(5).toString("hex")}`;
  const response = await post(context, "/api/account", { username, displayName, password });
  expect(response.status()).toBe(201);
  return { context, username, profile: (await response.json()).profile as { id: string; displayName: string } };
}

type Account = Awaited<ReturnType<typeof account>>;
async function friends(first: Account, second: Account) {
  expect((await post(first.context, "/api/social/friends", { username: second.username })).ok()).toBe(true);
  expect((await post(second.context, "/api/social/friends/respond", { profileId: first.profile.id, accept: true })).ok()).toBe(true);
}

const details = (page: Page, name: string) => page.getByRole("group", { name: `${name}'s social details`, exact: true });
const lobbyPlayer = (page: Page, name: string) => page.locator("ol > li").filter({ has: page.getByText(name, { exact: true }) });

async function audit(page: Page, stage: string) {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.evaluate(() => document.fonts.ready);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await page.getByRole("group", { name: /'s social details$/ }).evaluateAll((groups) => groups.filter((group) => {
      const rect = group.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1 || group.scrollWidth > group.clientWidth + 1;
    }).map((group) => group.getAttribute("aria-label")));
    expect(overflow, `${stage} social details at ${width}px`).toEqual([]);
    await page.screenshot({ path: `test-results/table-social/${stage}-${width}.png`, fullPage: true, animations: "disabled" });
  }
}

test.beforeEach(() => sql("delete from private.auth_limits;"));

test("table friends sort by seats and presence, and player cards show rank badges with working friend actions", async ({ browser, context }) => {
  test.setTimeout(150_000);
  const host = await account(browser, "Social Host");
  const here = await account(browser, "Zebra Here");
  const online = await account(browser, "Middle Online");
  const offline = await account(browser, "Alpha Offline");
  const stranger = await account(browser, "New Player");
  try {
    // The names intentionally sort opposite to the desired presence groups.
    await friends(host, offline);
    await friends(host, online);
    await friends(host, here);
    sql(`update public.profiles set rounds_played = 60 where id = '${here.profile.id}';
      update public.profiles set rounds_played = 40, rounds_won = 32 where id = '${stranger.profile.id}';`);
    const table = await (await post(host.context, "/api/games", {})).json();
    expect((await post(here.context, `/api/games/${table.code}/join`, {})).ok()).toBe(true);
    expect((await post(stranger.context, `/api/games/${table.code}/join`, {})).ok()).toBe(true);
    const guest = await (await post(context, `/api/games/${table.code}/join`, { name: "Guest Seat" })).json();
    expect(guest.token).toBeTruthy();
    const elsewhere = await (await post(online.context, "/api/games", {})).json();
    expect((await post(online.context, "/api/presence", {
      code: elsewhere.code, tabId: randomUUID(), sequence: 1, online: true,
    })).ok()).toBe(true);
    // A friend can remain seated without an open browser or a live heartbeat.
    const snapshot = (await (await host.context.request.get("/api/social")).json()).social;
    expect(snapshot.friends.find((friend: { id: string }) => friend.id === here.profile.id).online).toBe(false);
    expect(snapshot.friends.find((friend: { id: string }) => friend.id === online.profile.id).online).toBe(true);
    expect(snapshot.friends.find((friend: { id: string }) => friend.id === offline.profile.id).online).toBe(false);

    const expectedProfiles = [
      { id: host.profile.id, handle: host.username, points: 0 },
      { id: here.profile.id, handle: here.username, points: 180 },
      { id: stranger.profile.id, handle: stranger.username, points: 408 },
    ].sort((a, b) => a.id.localeCompare(b.id));
    // Seated players and anonymous/account spectators get the same public data.
    // Relationships, credentials, guests and unrelated accounts are absent.
    for (const viewer of [host.context, context, offline.context]) {
      const response = await viewer.request.get(`/api/games/${table.code}/profiles`);
      expect(response.status()).toBe(200);
      const payload = await response.json();
      expect(Object.keys(payload)).toEqual(["profiles"]);
      expect(payload.profiles.map((profile: { id: string }) => profile).sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))).toEqual(expectedProfiles);
      for (const profile of payload.profiles) expect(Object.keys(profile).sort()).toEqual(["handle", "id", "points"]);
      expect(JSON.stringify(payload)).not.toMatch(/token|password|session|friend|relation/i);
    }

    const page = await host.context.newPage();
    await page.addInitScript(() => localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true })));
    await page.goto(`/g/${table.code}`);
    const panel = page.getByRole("region", { name: "Friends", exact: true });
    await expect(panel.locator('li a[href^="/p/"]')).toHaveText(["Zebra Here", "Middle Online", "Alpha Offline"]);
    const hereRow = panel.getByRole("listitem").filter({ has: page.getByRole("link", { name: "Zebra Here", exact: true }) });
    await expect(hereRow).toContainText("At this table with you");
    await expect(hereRow.getByRole("button", { name: "Invite", exact: true })).toHaveCount(0);
    await expect(lobbyPlayer(page, "Zebra Here").getByRole("img", { name: "Silver rank", exact: true })).toBeVisible();
    await expect(details(page, "Zebra Here").getByText("Friend", { exact: true })).toBeVisible();
    await expect(lobbyPlayer(page, "New Player").getByRole("img", { name: "Gold rank", exact: true })).toBeVisible();
    await expect(lobbyPlayer(page, "Social Host").getByRole("img", { name: "Rookie rank", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: /'s social details$/ }).getByText(/^(Rookie|Silver|Gold)$/)).toHaveCount(0);
    await expect(details(page, "Social Host")).toHaveCount(0);
    await expect(details(page, "Guest Seat")).toHaveCount(0);
    await audit(page, "lobby");

    const outgoingRequest = page.waitForRequest((request) => request.url().endsWith("/api/social/friends") && request.method() === "POST");
    await details(page, "New Player").getByRole("button", { name: "Add friend", exact: true }).click();
    expect((await outgoingRequest).postDataJSON()).toMatchObject({ username: stranger.username, expectedProfileId: stranger.profile.id });
    await expect(details(page, "New Player").getByText("Request sent", { exact: true })).toBeVisible();
    expect((await post(stranger.context, "/api/social/friends/respond", { profileId: host.profile.id, accept: true })).ok()).toBe(true);
    await expect(details(page, "New Player").getByText("Friend", { exact: true })).toBeVisible();

    // Reset only the friendship, then exercise the same action on a live hand.
    expect((await post(host.context, "/api/social/friends/remove", { profileId: stranger.profile.id })).ok()).toBe(true);
    await expect(details(page, "New Player").getByRole("button", { name: "Add friend", exact: true })).toBeVisible();
    const started = page.waitForResponse((response) => response.url().endsWith(`/api/games/${table.code}/actions`)
      && response.request().postDataJSON()?.action.type === "start");
    await page.getByRole("button", { name: "Start round", exact: true }).click();
    expect((await started).ok()).toBe(true);
    for (const viewer of [host.context, here.context, stranger.context]) {
      expect((await action(viewer, table.code, { type: "ready" })).ok()).toBe(true);
    }
    expect((await action(context, table.code, { type: "ready" }, guest.token)).ok()).toBe(true);
    await expect.poll(async () => (await (await host.context.request.get(`/api/games/${table.code}/state`)).json()).view.public.phase, { timeout: 20_000 }).toBe("playing");
    await expect(page.getByRole("region", { name: "New Player's hand", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "New Player's hand", exact: true }).getByRole("img", { name: "Gold rank", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Zebra Here's hand", exact: true }).getByRole("img", { name: "Silver rank", exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Social Host's hand", exact: true }).getByRole("img", { name: "Rookie rank", exact: true })).toBeVisible();
    await expect(details(page, "Zebra Here").getByText("Friend", { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: /'s social details$/ }).getByText(/^(Rookie|Silver|Gold)$/)).toHaveCount(0);
    await expect(details(page, "Social Host")).toHaveCount(0);
    await expect(details(page, "Guest Seat")).toHaveCount(0);
    await audit(page, "playing");
    await details(page, "New Player").getByRole("button", { name: "Add friend", exact: true }).click();
    await expect(details(page, "New Player").getByText("Request sent", { exact: true })).toBeVisible();
    expect((await post(stranger.context, "/api/social/friends/respond", { profileId: host.profile.id, accept: true })).ok()).toBe(true);
    await expect(details(page, "New Player").getByText("Friend", { exact: true })).toBeVisible();

    // Incoming requests can be accepted directly on that player's live hand.
    expect((await post(host.context, "/api/social/friends/remove", { profileId: stranger.profile.id })).ok()).toBe(true);
    expect((await post(stranger.context, "/api/social/friends", { username: host.username })).ok()).toBe(true);
    await details(page, "New Player").getByRole("button", { name: "Accept friend", exact: true }).click();
    await expect(details(page, "New Player").getByText("Friend", { exact: true })).toBeVisible();
    const accepted = (await (await stranger.context.request.get("/api/social")).json()).social;
    expect(accepted.friends.some((friend: { id: string }) => friend.id === host.profile.id)).toBe(true);

    // A withdrawn request must not become a false Friend when the visible
    // snapshot is stale and the post-action refresh also cannot reach social.
    expect((await post(host.context, "/api/social/friends/remove", { profileId: stranger.profile.id })).ok()).toBe(true);
    expect((await post(stranger.context, "/api/social/friends", { username: host.username })).ok()).toBe(true);
    await expect(details(page, "New Player").getByRole("button", { name: "Accept friend", exact: true })).toBeVisible();
    let failedSnapshots = 0;
    const socialSnapshot = /\/api\/social$/;
    const unavailable = async (route: Route) => {
      failedSnapshots++;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Social is temporarily unavailable." } }) });
    };
    await page.route(socialSnapshot, unavailable);
    try {
      await expect.poll(() => failedSnapshots).toBeGreaterThan(0);
      expect((await post(stranger.context, "/api/social/friends/remove", { profileId: host.profile.id })).ok()).toBe(true);
      const response = page.waitForResponse((result) => result.url().endsWith("/api/social/friends/respond"));
      await details(page, "New Player").getByRole("button", { name: "Accept friend", exact: true }).click();
      expect((await (await response).json()).outcome).toBe("missing");
      await expect(page.getByRole("region", { name: "Notifications", exact: true }).getByRole("alert")).toHaveText("That friend request is no longer available.");
      await expect(details(page, "New Player").getByText("Friend", { exact: true })).toHaveCount(0);
      const actual = (await (await stranger.context.request.get("/api/social")).json()).social;
      expect(actual.friends.some((friend: { id: string }) => friend.id === host.profile.id)).toBe(false);
    } finally {
      await page.unroute(socialSnapshot, unavailable);
    }
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await details(page, "New Player").getByRole("button", { name: "Add friend", exact: true }).click();
    await expect(details(page, "New Player").getByText("Request sent", { exact: true })).toBeVisible();
    expect((await post(stranger.context, "/api/social/friends/respond", { profileId: host.profile.id, accept: true })).ok()).toBe(true);
    await expect(details(page, "New Player").getByText("Friend", { exact: true })).toBeVisible();

    expect((await action(context, table.code, { type: "leaveTable" }, guest.token)).ok()).toBe(true);
    const state = (await (await host.context.request.get(`/api/games/${table.code}/state`)).json()).view.public;
    const bot = state.players.find((player: { isBot: boolean }) => player.isBot);
    expect(bot).toBeTruthy();
    await expect(page.getByRole("region", { name: `${bot.name}'s hand`, exact: true })).toBeVisible();
    await expect(details(page, bot.name)).toHaveCount(0);
    await expect(page.getByRole("group", { name: /'s social details$/ })).toHaveCount(2);
  } finally {
    for (const player of [host, here, online, offline, stranger]) await player.context.close();
  }
});
