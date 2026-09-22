import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const origin = "http://localhost:3100";
const firstPassword = "First strong test password 42!";
const nextPassword = "Another strong test password 84!";
const suffix = () => Math.random().toString(36).slice(2, 10);
const database = process.env.E2E_DB_CONTAINER ?? "cambio-account-test-db";
function sql(text: string) {
  if (!/^cambio-(account-test|e2e)-db/.test(database)) throw new Error("Use an isolated Cambio test database.");
  return execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: text, encoding: "utf8" }).trim();
}
async function rpc(name: string, values: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:55434/rpc/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_secret: "account-test-secret", ...values }) });
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
  await page.getByRole("group", { name: "Account access options" }).getByRole("button", { name: "Create account", exact: true }).click();
  const signup = page.getByRole("form", { name: "Create account", exact: true });
  await signup.getByLabel("Username", { exact: true }).fill(username);
  await signup.getByLabel("Display name", { exact: true }).fill("McKenzie Lee");
  await signup.getByLabel("Password", { exact: true }).fill(firstPassword);
  await signup.getByLabel("Confirm password", { exact: true }).fill(firstPassword);
  await signup.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
  const initial = await (await context.request.get("/api/account")).json();
  expect(initial.username).toBe(username);
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
  expect((await post(context, "/api/social/friends", { handle: friend.profile.handle })).ok()).toBeTruthy();
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
  const rename = page.getByRole("form", { name: "Display name settings" });
  await rename.getByLabel("Display name", { exact: true }).fill("Alex Rivera");
  await rename.getByRole("button", { name: "Save display name" }).click();
  await expect(page.getByRole("status")).toContainText("Display name updated");
  state = await (await context.request.get(`/api/games/${seat.code}/state`)).json();
  expect(state.view.public.players.find((p: { id: string }) => p.id === seat.playerId).name).toBe("Alex Rivera");

  const usernameForm = page.getByRole("form", { name: "Username settings" });
  await usernameForm.getByLabel("Username", { exact: true }).fill(friendName);
  await usernameForm.getByLabel("Current password", { exact: true }).fill(firstPassword);
  await usernameForm.getByRole("button", { name: "Save username" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("That username is already taken.");
  await usernameForm.getByLabel("Username", { exact: true }).fill(nextUsername);
  await usernameForm.getByRole("button", { name: "Save username" }).click();
  await expect(page.getByRole("status")).toContainText("Username updated");

  const passwordForm = page.getByRole("form", { name: "Password settings" });
  await passwordForm.getByLabel("Current password", { exact: true }).fill("incorrect password");
  await passwordForm.getByLabel("New password", { exact: true }).fill(nextPassword);
  await passwordForm.getByLabel("Confirm new password", { exact: true }).fill(nextPassword);
  await passwordForm.getByRole("button", { name: "Change password" }).click();
  await expect(page.locator("main").getByRole("alert")).toHaveText("Your current password is incorrect.");
  await passwordForm.getByLabel("Current password", { exact: true }).fill(firstPassword);
  await passwordForm.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status")).toContainText("Password changed");
  expect((await (await otherDevice.request.get("/api/account")).json()).profile).toBeNull();
  expect((await post(otherDevice, "/api/account/login", { username: nextUsername, password: firstPassword })).status()).toBe(401);
  expect((await post(otherDevice, "/api/account/login", { username: nextUsername, password: nextPassword })).status()).toBe(200);

  const preLogoutCookie = (await context.cookies()).find((c) => c.name === "cambio_session")!;
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Cambio account" })).toBeVisible();
  expect((await context.request.post(`/api/games/${seat.code}/actions`, { headers: { origin, "x-cambio-token": seat.token }, data: { actionId: crypto.randomUUID(), action: { type: "start" } } })).status()).toBe(401);
  expect((await context.request.get("/api/account", { headers: { cookie: `cambio_session=${preLogoutCookie.value}` } })).ok()).toBeTruthy();
  expect((await (await context.request.get("/api/account", { headers: { cookie: `cambio_session=${preLogoutCookie.value}` } })).json()).profile).toBeNull();
  await context.clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await login(page, nextUsername, nextPassword);
  const restored = await (await context.request.get("/api/account")).json();
  expect(restored.profile.id).toBe(initial.profile.id);
  expect(restored.profile).toMatchObject({ displayName: "Alex Rivera", roundsWon: 1, bestScore: 2 });
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
  await expect(page.locator("main").getByRole("alert")).toHaveText("Your current password is incorrect.");
  await deletion.getByLabel("Current password", { exact: true }).fill(nextPassword);
  await deletion.getByRole("button", { name: "Permanently delete account" }).click();
  await expect(page.getByRole("heading", { name: "Your Cambio account" })).toBeVisible();
  expect((await post(context, "/api/account/login", { username: nextUsername, password: nextPassword })).status()).toBe(401);
  expect((await (await otherDevice.request.get("/api/account")).json()).profile).toBeNull();
  expect((await context.request.get(`/api/profile/${initial.profile.handle}`)).status()).toBe(404);
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
  await expect(page.getByRole("heading", { name: "Login username" })).toBeVisible();
  const account = await (await context.request.get("/api/account")).json();
  expect(account.profile).toMatchObject({ id: legacy.id, displayName: "Jamie Park", roundsWon: 1 });
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
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your Cambio account" })).toBeVisible();
  await expect(otherTab.getByRole("heading", { name: "Your Cambio account" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("form", { name: "Log in", exact: true })).toBeVisible();
  await otherTab.close();
});

test("credentials endpoints reject cross site requests and old profile creation", async ({ context }) => {
  expect((await context.request.post("/api/account", { headers: { origin: "https://other.example" }, data: { username: `csrf${suffix()}`, displayName: "CSRF User", password: firstPassword } })).status()).toBe(403);
  expect((await post(context, "/api/profile", { name: "Browser Only" })).status()).toBe(410);
  expect((await post(context, "/api/account/login", { username: "missinguser", password: firstPassword })).status()).toBe(401);
});
