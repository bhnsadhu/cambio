import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const password = "A leaderboard test password 72!";
const post = (context: BrowserContext, path: string, data: unknown) => context.request.post(path, { headers: { origin }, data });
function sql(text: string) {
  const database = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(database)) throw new Error("Use the isolated test database.");
  return execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: text, encoding: "utf8" }).trim();
}
async function account(browser: Browser, displayName: string) {
  const context = await browser.newContext({ baseURL: origin });
  const username = `rank${randomBytes(5).toString("hex")}`;
  const response = await post(context, "/api/account", { username, displayName, password });
  expect(response.status()).toBe(201);
  return { context, username, profile: (await response.json()).profile };
}
async function friends(a: Awaited<ReturnType<typeof account>>, b: Awaited<ReturnType<typeof account>>) {
  expect((await post(a.context, "/api/social/friends", { username: b.username })).ok()).toBe(true);
  expect((await post(b.context, "/api/social/friends/respond", { profileId: a.profile.id, accept: true })).ok()).toBe(true);
}

test("standings share tied ranks, include only accepted friends, and follow account changes", async ({ browser, page }) => {
  const me = await account(browser, "Ranked Player");
  const tied = await account(browser, "Tied Friend");
  const first = await account(browser, "Leading Friend");
  const pending = await account(browser, "Pending Player");
  const stranger = await account(browser, "Other Player");
  try {
    await friends(me, tied); await friends(first, me);
    await post(me.context, "/api/social/friends", { username: pending.username });
    sql(`update public.profiles set rounds_played = 10, rounds_won = 5 where id in ('${me.profile.id}', '${tied.profile.id}');
      update public.profiles set rounds_played = 10, rounds_won = 6 where id = '${first.profile.id}';
      update public.profiles set rounds_played = 100, rounds_won = 100 where id in ('${pending.profile.id}', '${stranger.profile.id}');`);
    const board = await (await me.context.request.get("/api/leaderboard?scope=friends")).json();
    expect(board.total).toBe(3);
    expect(board.entries.map((entry: { rank: number }) => entry.rank)).toEqual([1, 2, 2]);
    expect(board.me).toMatchObject({ id: me.profile.id, rank: 2, points: 75 });
    expect(board.entries[0].id).toBe(first.profile.id);
    expect(JSON.stringify(board)).not.toMatch(/token|session|password|lastSeen|createdAt/);
    const all = await (await me.context.request.get("/api/leaderboard?scope=all")).json();
    const record = await (await me.context.request.get("/api/account")).json();
    expect(all.me.rank).toBe(record.profile.rank);
    expect(all.total).toBe(record.profile.totalPlayers);
    expect(all.entries.some((entry: { id: string }) => entry.id === stranger.profile.id)).toBe(true);
    expect((await page.request.get(`/api/leaderboard?scope=friends&profileId=${me.profile.id}`)).status()).toBe(401);
    for (const query of ["scope=private", "offset=-1", "offset=1.5", "offset=999999999999999"]) {
      expect((await page.request.get(`/api/leaderboard?${query}`)).status()).toBe(400);
    }
    const badSecret = await fetch(`${process.env.E2E_REST_ORIGIN}/rpc/leaderboard_snapshot`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_secret: "wrong", p_id: me.profile.id, p_scope: "friends" }),
    });
    expect(badSecret.ok).toBe(false);

    const ownPage = await me.context.newPage();
    await ownPage.goto("/");
    await ownPage.getByRole("link", { name: "Friends leaderboard", exact: true }).click();
    await expect(ownPage.getByLabel("Your standing")).toContainText("2nd of 3");
    await expect(ownPage.getByRole("row", { name: "Your leaderboard row" })).toContainText("Ranked Player");
    await ownPage.getByRole("link", { name: "All players", exact: true }).click();
    await expect(ownPage.getByRole("region", { name: "All player standings" })).toBeVisible();
    for (const width of [390, 320]) {
      await ownPage.setViewportSize({ width, height: 844 });
      expect(await ownPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await ownPage.screenshot({ path: "test-results/leaderboard-account-mobile.png", fullPage: true });
    await ownPage.getByRole("link", { name: "Account settings" }).click();
    await ownPage.getByRole("link", { name: "Back to the leaderboard" }).click();
    await expect(ownPage).toHaveURL(`${origin}/leaderboard?scope=all`);

    await post(me.context, "/api/social/friends/remove", { profileId: first.profile.id });
    const afterRemoval = await (await me.context.request.get("/api/leaderboard?scope=friends")).json();
    expect(afterRemoval.total).toBe(2);
    expect(afterRemoval.me.rank).toBe(1);
    expect((await tied.context.request.patch("/api/account", { headers: { origin }, data: { displayName: "New Friend Name" } })).ok()).toBe(true);
    expect((await (await me.context.request.get("/api/leaderboard?scope=friends")).json()).entries.find((entry: { id: string }) => entry.id === tied.profile.id).displayName).toBe("New Friend Name");
    expect((await tied.context.request.delete("/api/account", { headers: { origin }, data: { currentPassword: password, confirmation: "DELETE" } })).ok()).toBe(true);
    await ownPage.goto("/leaderboard?scope=friends");
    await expect(ownPage.getByLabel("Your standing")).toContainText("1st of 1");
    await expect(ownPage.getByRole("link", { name: "Add friends", exact: true })).toHaveAttribute("href", "/#friends");
  } finally { for (const player of [me, tied, first, pending, stranger]) await player.context.close(); }
});

test("guests can browse everyone, login returns to friends, and own rank stays visible beyond page one", async ({ browser, page }) => {
  const me = await account(browser, "Pagination Player");
  const prefix = randomBytes(4).toString("hex");
  sql(`insert into public.profiles (handle, display_name, token_hash, rounds_played, rounds_won)
    select 'rank${prefix}' || n, 'Leaderboard Player', 'rank${prefix}' || n, 1000 + n, 1000 + n from generate_series(1, 60) n;`);
  try {
    const first = await (await me.context.request.get("/api/leaderboard")).json();
    expect(first.entries).toHaveLength(50);
    expect(first.nextOffset).toBe(50);
    expect(first.me.id).toBe(me.profile.id);
    expect(first.entries.some((entry: { id: string }) => entry.id === me.profile.id)).toBe(false);
    const second = await (await me.context.request.get("/api/leaderboard?offset=50")).json();
    expect(second.entries.some((entry: { id: string }) => first.entries.some((other: { id: string }) => other.id === entry.id))).toBe(false);
    await page.goto("/");
    await page.getByRole("link", { name: "Leaderboard", exact: true }).click();
    await expect(page.getByRole("link", { name: "All players", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("table")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Previous", exact: true }).click();
    await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Friends", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Compare scores with your friends" })).toBeVisible();
    await page.getByRole("link", { name: "Log in", exact: true }).last().click();
    const form = page.getByRole("form", { name: "Log in", exact: true });
    await form.getByLabel("Username", { exact: true }).fill(me.username);
    await form.getByLabel("Password", { exact: true }).fill(password);
    await form.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/leaderboard?scope=friends`);
    await expect(page.getByLabel("Your standing")).toContainText("1st of 1");
    await page.getByRole("link", { name: "All players", exact: true }).click();
    await expect(page.getByLabel("Your standing")).toContainText(`${first.me.rank}`);
    await expect(page.getByRole("row", { name: "Your leaderboard row" })).toHaveCount(0);
    await page.getByText("How points work", { exact: true }).click();
    await expect(page.getByText(/Earn 12 points for a win/)).toBeVisible();
    expect(await page.locator("main").innerText()).not.toMatch(/[—–]|\s-\s|\w-\w/);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "test-results/leaderboard.png", fullPage: true });
  } finally { await me.context.close(); }
});
