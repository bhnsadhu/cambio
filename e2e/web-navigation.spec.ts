import { test, expect, type BrowserContext } from "@playwright/test";
import { randomBytes } from "node:crypto";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const password = "Desktop navigation password 42!";
const post = (context: BrowserContext, path: string, data: unknown) => context.request.post(path, { headers: { origin }, data });
async function register(context: BrowserContext, displayName: string) {
  const username = `web${randomBytes(5).toString("hex")}`;
  const response = await post(context, "/api/account", { username, displayName, password });
  expect(response.status()).toBe(201);
  return { username, profile: (await response.json()).profile };
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true })));
});

test("browser navigation and a second tab can return to a saved seat, while leaving and expired tables clear it", async ({ page, context }) => {
  await page.goto("/");
  await page.getByLabel("Display name", { exact: true }).fill("Desktop Guest");
  await page.getByRole("button", { name: "Open a table", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  const tableUrl = page.url();
  const code = tableUrl.split("/").at(-1)!;
  const original = await page.evaluate((code) => JSON.parse(localStorage.getItem(`cambio:seat:${code}`)!), code);
  await page.getByRole("link", { name: "Cambio home", exact: true }).click();
  const resume = page.getByRole("link", { name: `Return to table ${code}`, exact: true });
  await expect(resume).toBeVisible();
  // A stale bookmark must not be offered as an active seat.
  await page.evaluate(() => localStorage.setItem("cambio:seat:ZZZZZ", JSON.stringify({ playerId: "expired", token: "expired", name: "Desktop Guest", savedAt: Date.now() })));
  await page.reload();
  await expect(resume).toBeVisible();
  await expect(page.getByRole("link", { name: "Return to table ZZZZZ", exact: true })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem("cambio:seat:ZZZZZ"))).toBeNull();
  const second = await context.newPage();
  await second.goto("/");
  await second.getByRole("link", { name: `Return to table ${code}`, exact: true }).click();
  await expect(second.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  expect(await second.evaluate((code) => JSON.parse(localStorage.getItem(`cambio:seat:${code}`)!).playerId, code)).toBe(original.playerId);
  await second.close();
  await resume.click();
  await expect(page).toHaveURL(tableUrl);
  await page.goBack();
  await expect(resume).toBeVisible();
  await resume.click();
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  const leave = page.getByRole("dialog", { name: "Leave this table?", exact: true });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "Stay", exact: true }).click();
  await expect(page).toHaveURL(tableUrl);
  await page.getByRole("button", { name: "Leave", exact: true }).click();
  await leave.getByRole("button", { name: "Leave", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(resume).toHaveCount(0);
});

test("friends failures show a retry path and failed approvals can be retried without losing the request", async ({ page, context, browser }) => {
  const me = await register(context, "Desktop Player");
  const friend = await browser.newContext({ baseURL: origin });
  try {
    await register(friend, "Desktop Friend");
    await post(friend, "/api/social/friends", { username: me.username });
    await page.route("**/api/social", (route) => route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Friends temporarily unavailable." } } }));
    await page.goto("/");
    const panel = page.getByRole("region", { name: "Friends", exact: true });
    await expect(panel.getByRole("alert")).toHaveText("Friends temporarily unavailable.");
    await expect(panel.getByText("No friends yet.", { exact: false })).toHaveCount(0);
    await page.unroute("**/api/social");
    await panel.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
    await page.route("**/api/social/friends/respond", (route) => route.fulfill({ status: 503, json: { error: { code: "UNAVAILABLE", message: "Could not accept. Try again." } } }));
    await panel.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(panel.getByRole("alert")).toHaveText("Could not accept. Try again.");
    await page.unroute("**/api/social/friends/respond");
    await panel.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(panel.getByRole("link", { name: "Desktop Friend", exact: true })).toBeVisible();
    for (const width of [1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const create = (await page.getByRole("form", { name: "New table", exact: true }).boundingBox())!;
      const join = (await page.getByRole("form", { name: "Join with code", exact: true }).boundingBox())!;
      const friends = (await panel.boundingBox())!;
      expect(Math.abs(create.y - join.y)).toBeLessThan(1);
      expect(Math.abs(create.y - friends.y)).toBeLessThan(1);
      expect(join.x).toBeGreaterThan(create.x + create.width);
      expect(friends.x).toBeGreaterThan(join.x + join.width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.screenshot({ path: "test-results/desktop-home.png", fullPage: true, animations: "disabled" });
  } finally { await friend.close(); }
});

test("signing in through settings preserves the return link and recovers the same table seat", async ({ page, context }) => {
  const me = await register(context, "Returning Player");
  const seat = await (await post(context, "/api/games", {})).json();
  await post(context, "/api/account/logout", {});
  const settings = `/me?${new URLSearchParams({ from: `/g/${seat.code}` })}`;
  await page.goto(settings);
  await expect(page.getByRole("heading", { name: "Welcome back", exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("next")).toBe(settings);
  await expect(page.getByRole("link", { name: "Back to the table", exact: true })).toHaveAttribute("href", `/g/${seat.code}`);
  const login = page.getByRole("form", { name: "Log in", exact: true });
  await login.getByLabel("Username", { exact: true }).fill(me.username);
  await login.getByLabel("Password", { exact: true }).fill(password);
  await login.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(`${origin}${settings}`);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("link", { name: "Account settings", exact: true }).click();
  await expect(page.getByRole("link", { name: "Back to the table", exact: true })).toHaveAttribute("href", `/g/${seat.code}`);
  await page.getByRole("link", { name: "Back to the table", exact: true }).click();
  await expect(page.getByRole("button", { name: "Start round", exact: true })).toBeVisible();
  const returned = await (await context.request.get(`/api/games/${seat.code}/state`)).json();
  expect(returned.me).toBe(seat.playerId);
  expect(returned.view.public.players).toHaveLength(1);
});
