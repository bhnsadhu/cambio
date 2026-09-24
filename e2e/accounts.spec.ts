import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const restOrigin = process.env.E2E_REST_ORIGIN ?? "http://127.0.0.1:55434";
const firstPassword = "First strong test password 42!";
const nextPassword = "Another strong test password 84!";
const suffix = () => Math.random().toString(36).slice(2, 10);
const database = process.env.E2E_DB_CONTAINER ?? "cambio-account-test-db";
function sql(text: string) {
  if (!/^cambio-(account-test|e2e)-db/.test(database)) throw new Error("Use an isolated Cambio test database.");
  return execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: text, encoding: "utf8" }).trim();
}
async function rpc(name: string, values: Record<string, unknown>) {
  const res = await fetch(`${restOrigin}/rpc/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_secret: "account-test-secret", ...values }) });
  expect(res.ok, await res.clone().text()).toBeTruthy();
  return res.status === 204 ? null : res.json();
}
async function post(context: BrowserContext, path: string, data: unknown) {
  return context.request.post(path, { headers: { origin }, data });
}
async function login(page: Page, username: string, password: string) {
  await page.goto("/me");
  const form = page.getByRole("form", { name: "Log in", exact: true });
  await form.getByLabel("Username", { exact: true }).fill(username);
  await form.getByLabel("Password", { exact: true }).fill(password);
  await form.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
}
async function noPunctuationDashes(page: Page) {
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/[—–]|\s-\s|\w-\w/);
  const transforms = await page.locator("h1, h2, h3, button").evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).textTransform));
  expect(transforms).not.toContain("lowercase");
}

test.beforeEach(() => sql("delete from private.auth_limits;"));

test("complete account lifecycle preserves identity and closes revoked sessions", async ({ page, context, browser }) => {
  const username = `player${suffix()}`;
  const nextUsername = `new${suffix()}`;
  await page.goto("/me");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  const signup = page.getByRole("form", { name: "Create account", exact: true });
  await signup.getByLabel("Username", { exact: true }).fill(username);
  await signup.getByLabel("Display name", { exact: true }).fill("McKenzie Lee");
  await signup.getByLabel("Password", { exact: true }).fill(firstPassword);
  await signup.getByLabel("Confirm password", { exact: true }).fill(firstPassword);
  await signup.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
  const initial = await (await context.request.get("/api/account")).json();
  expect(initial.username).toBe(username);
  expect(initial.profile.handle).toBe(username);
  expect(initial.profile.displayName).toBe("McKenzie Lee");
  expect(JSON.stringify(initial)).not.toMatch(/password_hash|session_hash|token_hash/);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "cambio_session")).toMatchObject({ httpOnly: true, sameSite: "Lax" });
  await noPunctuationDashes(page);
  await page.screenshot({ path: "test-results/account-settings.png", fullPage: true });

  const friendContext = await browser.newContext({ baseURL: origin });
  const friendName = `friend${suffix()}`;
  const friend = await (await post(friendContext, "/api/account", { username: friendName, displayName: "Taylor Jones", password: firstPassword })).json();
  expect(friend.profile?.id).toBeTruthy();
  expect(friend.profile.handle).toBe(friendName);
  await page.goto("/");
  await page.getByRole("textbox", { name: "Add a friend by username" }).fill(`@${friendName.toUpperCase()}`);
  await page.getByRole("region", { name: "Friends", exact: true }).getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText(`Request sent to @${friendName}.`, { exact: true })).toBeVisible();
  expect((await post(friendContext, "/api/social/friends/respond", { profileId: initial.profile.id, accept: true })).ok()).toBeTruthy();
  await rpc("profile_record_round", { p_rows: [{ profile_id: initial.profile.id, won: true, score: 2, sticks: 3, misses: 0, called: true, first_round: true, opponents: [friend.profile.id] }] });
  await page.reload();
  await expect(page.getByText("Taylor Jones", { exact: true }).first()).toBeVisible();
  const record = await (await context.request.get("/api/account")).json();
  expect(record.profile).toMatchObject({ roundsPlayed: 1, roundsWon: 1, bestScore: 2 });

  // Signed in game creation ignores a forged name supplied by a client.
  const seat = await (await post(context, "/api/games", { name: "Forged Username" })).json();
  let state = await (await context.request.get(`/api/games/${seat.code}/state`)).json();
  expect(state.view.public.players.find((p: { id: string }) => p.id === seat.playerId).name).toBe("McKenzie Lee");
  const otherDevice = await browser.newContext({ baseURL: origin });
  expect((await post(otherDevice, "/api/account/login", { username: username.toUpperCase(), password: firstPassword })).ok()).toBeTruthy();
  await page.goto("/me");
  const otherPage = await otherDevice.newPage();
  await otherPage.goto("/me");
  await expect(otherPage.getByRole("region", { name: "Username", exact: true })).toContainText(`@${username}`);
  await expect(page.getByRole("form", { name: "Display name settings" })).toHaveCount(0);
  await page.getByRole("button", { name: "Change display name" }).click();
  const rename = page.getByRole("form", { name: "Display name settings" });
  await expect(rename.getByLabel("Display name", { exact: true })).toBeFocused();
  await rename.getByLabel("Display name", { exact: true }).fill("Unsaved Name");
  await rename.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(rename).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Change display name" })).toBeFocused();
  await page.getByRole("button", { name: "Change display name" }).click();
  await expect(rename.getByLabel("Display name", { exact: true })).toHaveValue("McKenzie Lee");
  await rename.getByLabel("Display name", { exact: true }).fill("Alex Rivera");
  await rename.getByRole("button", { name: "Save display name" }).click();
  await expect(page.getByRole("status")).toContainText("Display name updated");
  await expect(rename).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Display name", exact: true })).toContainText("Alex Rivera");
  state = await (await context.request.get(`/api/games/${seat.code}/state`)).json();
  expect(state.view.public.players.find((p: { id: string }) => p.id === seat.playerId).name).toBe("Alex Rivera");

  await page.getByRole("button", { name: "Change username" }).click();
  const usernameForm = page.getByRole("form", { name: "Username settings" });
  await usernameForm.getByLabel("Username", { exact: true }).fill(friendName);
  await usernameForm.getByLabel("Current password", { exact: true }).fill(firstPassword);
  await usernameForm.getByRole("button", { name: "Save username" }).click();
  await expect(page.getByRole("region", { name: "Notifications", exact: true }).getByRole("alert")).toHaveText("That username is already taken.");
  await usernameForm.getByLabel("Username", { exact: true }).fill(nextUsername);
  await usernameForm.getByRole("button", { name: "Save username" }).click();
  await expect(page.getByRole("status")).toContainText("Username updated");
  await expect(usernameForm).toHaveCount(0);
  expect((await context.request.get(`/api/profile/${username}`)).status()).toBe(404);
  const publicProfile = await (await friendContext.request.get(`/api/profile/@${nextUsername.toUpperCase()}`)).json();
  expect(publicProfile).toMatchObject({ profile: { id: initial.profile.id, handle: nextUsername, displayName: "Alex Rivera", roundsWon: 1 }, relation: "friends" });
  const friendView = await (await friendContext.request.get("/api/social")).json();
  expect(friendView.social.friends[0]).toMatchObject({ id: initial.profile.id, handle: nextUsername, displayName: "Alex Rivera" });
  expect((await post(friendContext, "/api/social/friends", { username: `@${nextUsername}` })).ok()).toBeTruthy();
  expect((await post(friendContext, "/api/social/friends", { username: `${nextUsername}!` })).status()).toBe(404);
  await expect(otherPage.getByRole("region", { name: "Username", exact: true })).toContainText(`@${nextUsername}`, { timeout: 15_000 });
  await otherPage.getByRole("button", { name: "Change username" }).click();
  await expect(otherPage.getByRole("form", { name: "Username settings" }).getByLabel("Username", { exact: true })).toHaveValue(nextUsername);

  await page.getByRole("button", { name: "Change password" }).click();
  const passwordForm = page.getByRole("form", { name: "Password settings" });
  await passwordForm.getByLabel("Current password", { exact: true }).fill("incorrect password");
  await passwordForm.getByLabel("New password", { exact: true }).fill(nextPassword);
  await passwordForm.getByLabel("Confirm new password", { exact: true }).fill(nextPassword);
  await passwordForm.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("region", { name: "Notifications", exact: true }).getByRole("alert")).toHaveText("Your current password is incorrect.");
  await passwordForm.getByLabel("Current password", { exact: true }).fill(firstPassword);
  await passwordForm.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByRole("status")).toContainText("Password changed");
  expect((await (await otherDevice.request.get("/api/account")).json()).profile).toBeNull();
  expect((await post(otherDevice, "/api/account/login", { username: nextUsername, password: firstPassword })).status()).toBe(401);
  expect((await post(otherDevice, "/api/account/login", { username: nextUsername, password: nextPassword })).status()).toBe(200);

  const preLogoutCookie = (await context.cookies()).find((c) => c.name === "cambio_session")!;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole("status")).toContainText("You are signed out");
  expect((await context.request.post(`/api/games/${seat.code}/actions`, { headers: { origin, "x-cambio-token": seat.token }, data: { actionId: crypto.randomUUID(), action: { type: "start" } } })).status()).toBe(401);
  expect((await context.request.get("/api/account", { headers: { cookie: `cambio_session=${preLogoutCookie.value}` } })).ok()).toBeTruthy();
  expect((await (await context.request.get("/api/account", { headers: { cookie: `cambio_session=${preLogoutCookie.value}` } })).json()).profile).toBeNull();
  await context.clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await login(page, nextUsername, nextPassword);
  const restored = await (await context.request.get("/api/account")).json();
  expect(restored.profile.id).toBe(initial.profile.id);
  expect(restored.profile).toMatchObject({ displayName: "Alex Rivera", roundsWon: 1, bestScore: 2 });
  await page.goto("/");
  await expect(page.getByText("Taylor Jones", { exact: true }).first()).toBeVisible();
  await page.goto(`/g/${seat.code}`);
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  await expect(page.getByText("Alex Rivera", { exact: true }).first()).toBeVisible();
  await noPunctuationDashes(page);
  await page.goto("/me");

  await page.getByRole("button", { name: "Delete account", exact: true }).click();
  const deletion = page.getByRole("form", { name: "Confirm account deletion" });
  await deletion.getByLabel("Current password", { exact: true }).fill("incorrect password");
  await deletion.getByLabel("Type DELETE to confirm").fill("DELETE");
  await deletion.getByRole("button", { name: "Permanently delete account" }).click();
  await expect(page.getByRole("region", { name: "Notifications", exact: true }).getByRole("alert")).toHaveText("Your current password is incorrect.");
  await deletion.getByLabel("Current password", { exact: true }).fill(nextPassword);
  await deletion.getByRole("button", { name: "Permanently delete account" }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole("status")).toHaveText("Your account was deleted.");
  expect((await post(context, "/api/account/login", { username: nextUsername, password: nextPassword })).status()).toBe(401);
  expect((await (await otherDevice.request.get("/api/account")).json()).profile).toBeNull();
  expect((await context.request.get(`/api/profile/${nextUsername}`)).status()).toBe(404);
  const friendsAfter = await (await friendContext.request.get("/api/social")).json();
  expect(friendsAfter.social.friends).toHaveLength(0);
  state = await (await context.request.get(`/api/games/${seat.code}/state`)).json();
  expect(state.me).toBeNull();
  expect(state.view.public.players.find((p: { id: string }) => p.id === seat.playerId)).toMatchObject({ name: "Deleted player", profileId: null });
  await friendContext.close();
  await otherDevice.close();
});

test("legacy upgrade preserves the existing profile and invalidates its browser key", async ({ page, context }) => {
  const token = `legacy${suffix()}`;
  const legacy = await rpc("profile_create", { p_handle: `old${suffix()}`, p_display_name: "Jamie Park", p_token_hash: createHash("sha256").update(token).digest("hex") });
  await rpc("profile_record_round", { p_rows: [{ profile_id: legacy.id, won: true, score: 4, sticks: 1, misses: 0, opponents: [] }] });
  const profile = await (await context.request.get("/api/profile", { headers: { "x-cambio-profile": token } })).json();
  await page.goto("/me");
  await page.evaluate((stored) => localStorage.setItem("cambio:profile", JSON.stringify(stored)), { token, profile: profile.profile });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Secure your saved profile" })).toBeVisible();
  const form = page.getByRole("form", { name: "Create account", exact: true });
  const username = `secure${suffix()}`;
  await form.getByLabel("Username", { exact: true }).fill(username);
  await form.getByLabel("Password", { exact: true }).fill(firstPassword);
  await form.getByLabel("Confirm password", { exact: true }).fill(firstPassword);
  await form.getByRole("button", { name: "Secure this profile" }).click();
  await expect(page.getByRole("heading", { name: "Username", exact: true })).toBeVisible();
  const account = await (await context.request.get("/api/account")).json();
  expect(account.profile).toMatchObject({ id: legacy.id, handle: username, displayName: "Jamie Park", roundsWon: 1 });
  await context.clearCookies();
  const expired = await (await context.request.get("/api/profile", { headers: { "x-cambio-profile": token } })).json();
  expect(expired.profile).toBeNull();
  await page.evaluate(() => localStorage.clear());
  await login(page, username, firstPassword);
  expect((await (await context.request.get("/api/account")).json()).profile.id).toBe(legacy.id);
});

test("logout reaches another open tab and a delayed response cannot restore the account", async ({ page, context }) => {
  const username = `tabs${suffix()}`;
  expect((await post(context, "/api/account", { username, displayName: "Morgan Reed", password: firstPassword })).status()).toBe(201);
  await page.goto("/me");
  await expect(page.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
  const otherTab = await context.newPage();
  await otherTab.goto("/me");
  await expect(otherTab.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
  await page.route("**/api/account/logout", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { message: "Could not sign out. Try again." } }) }));
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("region", { name: "Notifications", exact: true }).getByRole("alert")).toHaveText("Could not sign out. Try again.");
  await expect(page.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
  await page.unroute("**/api/account/logout");

  let release!: () => void;
  let captured!: () => void;
  let delivered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const capturedResponse = new Promise<void>((resolve) => { captured = resolve; });
  const deliveredResponse = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route("**/api/social", async (route) => {
    const response = await route.fetch();
    captured();
    await gate;
    await route.fulfill({ response });
    delivered();
  });
  await page.goto("/");
  await capturedResponse;
  await page.getByRole("link", { name: "Account settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  release();
  await deliveredResponse;
  await expect(page).toHaveURL(`${origin}/`);
  expect(await page.evaluate(() => localStorage.getItem("cambio:profile"))).toBeNull();
  await expect(otherTab.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Log in", exact: true })).toBeVisible();
  await otherTab.close();
});

test("password rotation keeps open tabs signed in while the replacement cookie is in transit", async ({ page, context, browser }) => {
  const username = `rotate${suffix()}`;
  const account = await (await post(context, "/api/account", { username, displayName: "Jordan Quinn", password: firstPassword })).json();
  expect(account.profile?.id).toBeTruthy();
  const oldCookie = (await context.cookies()).find((cookie) => cookie.name === "cambio_session")!;
  const otherDevice = await browser.newContext({ baseURL: origin });
  const otherTab = await context.newPage();
  let release!: () => void;
  let captured!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const capturedResponse = new Promise<void>((resolve) => { captured = resolve; });
  try {
    expect((await post(otherDevice, "/api/account/login", { username, password: firstPassword })).ok()).toBeTruthy();
    await page.goto("/me");
    await otherTab.goto("/me");
    await expect(otherTab.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
    await page.route("**/api/account", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      const response = await route.fetch();
      expect(response.ok()).toBeTruthy();
      // APIRequestContext can apply Set-Cookie early. Keep the original browser
      // cookie until the intercepted response actually reaches this tab.
      await context.addCookies([oldCookie]);
      captured();
      await gate;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Change password" }).click();
    const form = page.getByRole("form", { name: "Password settings" });
    await form.getByLabel("Current password", { exact: true }).fill(firstPassword);
    await form.getByLabel("New password", { exact: true }).fill(nextPassword);
    await form.getByLabel("Confirm new password", { exact: true }).fill(nextPassword);
    await form.getByRole("button", { name: "Save password" }).click();
    await capturedResponse;
    expect((await (await context.request.get("/api/account")).json()).profile).toBeNull();
    let refreshes = 0;
    const countRefresh = (request: { url(): string; method(): string }) => {
      if (request.url().endsWith("/api/account") && request.method() === "GET") refreshes += 1;
    };
    page.on("request", countRefresh);
    otherTab.on("request", countRefresh);
    for (const tab of [page, otherTab]) {
      await tab.bringToFront();
      await tab.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    }
    // Give refresh callbacks time to run while the server has revoked the old
    // session but this browser has not received its replacement yet.
    await page.waitForTimeout(800);
    expect(refreshes).toBe(0);
    for (const tab of [page, otherTab]) {
      await expect(tab.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
      expect(await tab.evaluate(() => JSON.parse(localStorage.getItem("cambio:profile")!).profile.id)).toBe(account.profile.id);
    }
    release();
    await expect(page.getByRole("status")).toContainText("Password changed");
    await expect.poll(() => refreshes).toBeGreaterThan(0);
    for (const tab of [page, otherTab]) {
      await tab.reload();
      await expect(tab.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
    }
    expect((await (await context.request.get("/api/account")).json()).profile.id).toBe(account.profile.id);
    expect((await (await otherDevice.request.get("/api/account")).json()).profile).toBeNull();
    expect((await post(otherDevice, "/api/account/login", { username, password: firstPassword })).status()).toBe(401);
    expect((await post(otherDevice, "/api/account/login", { username, password: nextPassword })).ok()).toBeTruthy();
  } finally {
    release();
    await otherTab.close();
    await otherDevice.close();
  }
});

test("a late session error cannot undo a completed account change", async ({ page, context }) => {
  const username = `stale${suffix()}`;
  const account = await (await post(context, "/api/account", { username, displayName: "Sam Rivers", password: firstPassword })).json();
  expect(account.profile?.id).toBeTruthy();
  let release!: () => void;
  let captured!: () => void;
  let delivered!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const capturedResponse = new Promise<void>((resolve) => { captured = resolve; });
  const deliveredResponse = new Promise<void>((resolve) => { delivered = resolve; });
  await page.route("**/api/social", async (route) => {
    captured();
    await gate;
    await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { code: "SESSION", message: "Old session" } }) });
    delivered();
  }, { times: 1 });
  try {
    await page.goto("/");
    await capturedResponse;
    await page.getByRole("link", { name: "Account settings", exact: true }).click();
    await page.getByRole("button", { name: "Change display name" }).click();
    const form = page.getByRole("form", { name: "Display name settings" });
    await form.getByLabel("Display name", { exact: true }).fill("Sam Rivera");
    await form.getByRole("button", { name: "Save display name" }).click();
    await expect(page.getByRole("status")).toContainText("Display name updated");
    release();
    await deliveredResponse;
    await expect(page.getByRole("region", { name: "Display name", exact: true })).toContainText("Sam Rivera");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cambio:profile")!).profile.id)).toBe(account.profile.id);
    await page.reload();
    await expect(page.getByRole("region", { name: "Display name", exact: true })).toContainText("Sam Rivera");
  } finally { release(); }
});

test("credentials endpoints reject cross site requests and old profile creation", async ({ context }) => {
  expect((await context.request.post("/api/account", { headers: { origin: "https://other.example" }, data: { username: `csrf${suffix()}`, displayName: "CSRF User", password: firstPassword } })).status()).toBe(403);
  expect((await post(context, "/api/profile", { name: "Browser Only" })).status()).toBe(410);
  expect((await post(context, "/api/account/login", { username: "missinguser", password: firstPassword })).status()).toBe(401);
});

test("account access, tables, and help keep clear copy and responsive settings", async ({ page, context }) => {
  const username = `layout${suffix()}`;
  expect((await post(context, "/api/account", { username, displayName: "Casey ONeil", password: firstPassword })).status()).toBe(201);
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Play Cambio" })).toContainText("Playing as Casey ONeil");
  await expect(page.getByLabel("Display name", { exact: true })).toHaveCount(0);
  await noPunctuationDashes(page);
  await page.getByRole("button", { name: "Open a table", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "How Cambio works" })).toBeVisible();
  await noPunctuationDashes(page);
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  await noPunctuationDashes(page);
  await page.getByRole("button", { name: "How to play", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "How Cambio works" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "How to play", exact: true })).toBeVisible();
  await noPunctuationDashes(page);
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await page.getByRole("button", { name: "Start round", exact: true }).click();
  await expect(page.getByRole("button", { name: "I'm ready", exact: true })).toBeVisible();
  await noPunctuationDashes(page);
  await page.getByRole("button", { name: "I'm ready", exact: true }).click();
  await expect(page.getByRole("region", { name: "Casey ONeil's hand", exact: true }).getByRole("heading")).toBeVisible();
  await noPunctuationDashes(page);
  await page.screenshot({ path: "test-results/game-table.png", fullPage: true });
  await page.goto("/me");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Change username" })).toBeVisible();
  await noPunctuationDashes(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/account-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Change username" }).click();
  await noPunctuationDashes(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/account-mobile-edit.png", fullPage: true });
  await page.getByRole("form", { name: "Username settings" }).getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await page.getByRole("link", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/login-mobile.png", fullPage: true });
});
