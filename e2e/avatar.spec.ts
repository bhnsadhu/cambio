import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const password = "An avatar test password 42!";
const post = (context: BrowserContext, path: string, data: unknown) => context.request.post(path, { headers: { origin }, data });
const patch = (context: BrowserContext, data: unknown) => context.request.patch("/api/account", { headers: { origin }, data });

test.beforeEach(() => {
  const database = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(database)) throw new Error("Use the isolated test database.");
  execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], { input: "delete from private.auth_limits;", encoding: "utf8" });
});

async function account(browser: Browser, displayName: string) {
  const context = await browser.newContext({ baseURL: origin });
  const username = `avatar${randomBytes(5).toString("hex")}`;
  const response = await post(context, "/api/account", { username, displayName, password });
  expect(response.status()).toBe(201);
  return { context, username, profile: (await response.json()).profile };
}

test("avatar choices persist across devices, public records, friends, standings and an open table", async ({ browser, page: publicPage }) => {
  const me = await account(browser, "Avatar Player");
  const friend = await account(browser, "Avatar Friend");
  const otherDevice = await browser.newContext({ baseURL: origin });
  try {
    expect((await post(me.context, "/api/social/friends", { username: friend.username })).ok()).toBe(true);
    expect((await post(friend.context, "/api/social/friends/respond", { profileId: me.profile.id, accept: true })).ok()).toBe(true);
    expect((await post(otherDevice, "/api/account/login", { username: me.username, password })).ok()).toBe(true);

    const page = await me.context.newPage();
    await page.goto("/me");
    const avatar = page.getByRole("region", { name: "Avatar", exact: true });
    const preview = avatar.locator("[data-avatar-index]").first();
    await expect(preview).toBeVisible();
    const original = Number(await preview.getAttribute("data-avatar-index"));
    expect(original).toBeGreaterThanOrEqual(0);
    expect(original).toBeLessThan(6);
    const selected = (original + 1) % 6;
    const editor = page.getByRole("form", { name: "Avatar settings", exact: true });

    await page.getByRole("button", { name: "Change avatar", exact: true }).click();
    const radios = editor.getByRole("radio");
    await expect(radios).toHaveCount(6);
    for (let option = 0; option < 6; option++) await expect(radios.nth(option)).toHaveAccessibleName(/\S/);
    await expect(radios.nth(original)).toBeChecked();
    await radios.nth(selected).check();
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(preview).toHaveAttribute("data-avatar-index", String(original));
    await expect(page.getByRole("button", { name: "Change avatar", exact: true })).toBeFocused();
    expect((await (await me.context.request.get("/api/account")).json()).profile.avatarId).toBe(me.profile.avatarId);

    // Keep these views open while changing the account, so live refresh is
    // exercised rather than only reading freshly navigated pages.
    const devicePage = await otherDevice.newPage();
    await devicePage.goto("/me");
    const deviceAvatar = devicePage.getByRole("region", { name: "Avatar", exact: true }).locator("[data-avatar-index]").first();
    await expect(deviceAvatar).toHaveAttribute("data-avatar-index", String(original));
    const friendsPage = await friend.context.newPage();
    await friendsPage.goto("/");
    const friendRow = friendsPage.getByRole("region", { name: "Friends", exact: true }).getByRole("listitem").filter({ has: friendsPage.getByRole("link", { name: "Avatar Player", exact: true }) });
    await expect(friendRow.locator("[data-avatar-index]")).toHaveAttribute("data-avatar-index", String(original));
    const seatResponse = await post(me.context, "/api/games", { name: "Avatar Player" });
    expect(seatResponse.ok()).toBe(true);
    const seat = await seatResponse.json();
    const tablePage = await me.context.newPage();
    await tablePage.goto(`/g/${seat.code}`);
    const tableAvatar = tablePage.locator("ol > li").filter({ hasText: "Avatar Player" }).locator("[data-avatar-index]");
    await expect(tableAvatar).toHaveAttribute("data-avatar-index", String(original));

    await page.getByRole("button", { name: "Change avatar", exact: true }).click();
    await expect(radios.nth(original)).toBeChecked();
    await radios.nth(selected).check();
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: "test-results/avatar-picker-mobile.png", fullPage: true });
    await editor.getByRole("button", { name: "Save avatar", exact: true }).click();
    await expect(editor).toHaveCount(0);
    await expect(preview).toHaveAttribute("data-avatar-index", String(selected));
    await expect(deviceAvatar).toHaveAttribute("data-avatar-index", String(selected), { timeout: 15_000 });
    await expect(friendRow.locator("[data-avatar-index]")).toHaveAttribute("data-avatar-index", String(selected), { timeout: 15_000 });
    await expect(tableAvatar).toHaveAttribute("data-avatar-index", String(selected), { timeout: 15_000 });
    const state = await (await me.context.request.get(`/api/games/${seat.code}/state`)).json();
    expect(state.view.public.players.find((player: { id: string }) => player.id === seat.playerId)).toMatchObject({ avatarId: selected });

    await page.reload();
    await expect(preview).toHaveAttribute("data-avatar-index", String(selected));
    await publicPage.goto(`/p/${me.username}`);
    await expect(publicPage.getByRole("region", { name: "Avatar Player's record", exact: true }).locator("[data-avatar-index]")).toHaveAttribute("data-avatar-index", String(selected));
    await friendsPage.goto("/leaderboard?scope=friends");
    const standing = friendsPage.getByRole("row").filter({ has: friendsPage.locator(`a[href="/p/${me.username}"]`) });
    await expect(standing.locator("[data-avatar-index]")).toHaveAttribute("data-avatar-index", String(selected));

    // The picker remains available after saving; a second choice replaces the
    // persisted avatar without requiring a new account or a new table.
    const replacement = (selected + 1) % 6;
    await page.getByRole("button", { name: "Change avatar", exact: true }).click();
    await expect(radios.nth(selected)).toBeChecked();
    await radios.nth(replacement).check();
    await editor.getByRole("button", { name: "Save avatar", exact: true }).click();
    await expect(preview).toHaveAttribute("data-avatar-index", String(replacement));
    await expect(tableAvatar).toHaveAttribute("data-avatar-index", String(replacement), { timeout: 15_000 });
  } finally {
    await me.context.close();
    await friend.context.close();
    await otherDevice.close();
  }
});

test("avatar updates validate every choice and preserve credentials and other profile fields", async ({ browser, context: anonymous }) => {
  expect((await patch(anonymous, { avatarId: 1 })).status()).toBe(401);
  const me = await account(browser, "Unchanged Name");
  const otherDevice = await browser.newContext({ baseURL: origin });
  try {
    expect((await post(otherDevice, "/api/account/login", { username: me.username, password })).ok()).toBe(true);
    for (const avatarId of [0, 1, 2, 3, 4, 5]) {
      const response = await patch(me.context, { avatarId });
      expect(response.status(), await response.text()).toBe(200);
      const saved = await (await me.context.request.get("/api/account")).json();
      expect(saved).toMatchObject({ username: me.username, profile: { id: me.profile.id, handle: me.username, displayName: "Unchanged Name", avatarId } });
    }
    for (const avatarId of [-1, 6, 1.5, "2", null, false, {}]) {
      expect((await patch(me.context, { avatarId })).status()).toBe(400);
      expect((await (await me.context.request.get("/api/account")).json()).profile.avatarId).toBe(5);
    }
    // Avatar-only updates neither rotate/revoke sessions nor change the
    // password; the second device remains signed in and the old password works.
    expect((await (await otherDevice.request.get("/api/account")).json()).profile).toMatchObject({ id: me.profile.id, avatarId: 5 });
    expect((await post(anonymous, "/api/account/login", { username: me.username, password })).ok()).toBe(true);
    expect((await (await anonymous.request.get("/api/account")).json()).profile).toMatchObject({ id: me.profile.id, displayName: "Unchanged Name", avatarId: 5 });
  } finally {
    await me.context.close();
    await otherDevice.close();
  }
});
