import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { makeCtx, player, started, table } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";
import type { Profile } from "../src/lib/social/types";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const header = (page: Page) => page.locator("[data-app-header]");

test.beforeEach(async ({ page }) => {
  const database = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(database)) throw new Error("Use the isolated test database.");
  execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: "delete from private.auth_limits;", encoding: "utf8",
  });
  await page.addInitScript(() => localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true })));
});

async function createAccount(context: BrowserContext) {
  const username = `header${randomBytes(4).toString("hex")}`;
  const response = await context.request.post("/api/account", {
    headers: { origin }, data: { username, displayName: "Header Player", password: "Header navigation password 42!" },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).profile as Profile;
}

async function websiteNavigation(page: Page, account: boolean, active: string | null, back?: string) {
  const nav = header(page).getByRole("navigation", { name: "Main navigation", exact: true });
  await expect(nav).toBeVisible();
  await expect(header(page).getByRole("link", { name: "Cambio home", exact: true })).toHaveAttribute("href", "/");
  const labels = await nav.locator("[data-header-control]").evaluateAll((elements) => elements.map((element) =>
    element.getAttribute("aria-label") ?? element.textContent?.trim()));
  expect(labels).toEqual([
    "Tables", "Leaderboard", ...(account ? ["Your record", "Account settings"] : ["Log in"]), "How to play", ...(back ? [back] : []),
  ]);
  const current = nav.locator('[aria-current="page"]');
  await expect(current).toHaveCount(active ? 1 : 0);
  if (active) await expect(nav.getByRole("link", { name: active, exact: true })).toHaveAttribute("aria-current", "page");
}

/** One geometry contract covers every route, without duplicating game behavior tests. */
async function auditHeader(page: Page, surface: string) {
  await expect(header(page)).toHaveCount(1);
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.evaluate(() => document.fonts.ready);
    const geometry = await header(page).evaluate((element) => {
      const controls = Array.from(element.querySelectorAll<HTMLElement>("[data-header-control]"));
      const eligible = Array.from(element.querySelectorAll<HTMLElement>("a, button"))
        .filter((item) => !item.closest('[role="dialog"]') && item.getAttribute("aria-label") !== "Cambio home");
      const rect = element.getBoundingClientRect();
      return {
        missing: eligible.filter((item) => !item.hasAttribute("data-header-control")).map((item) => item.textContent?.trim()),
        extra: controls.filter((item) => item.closest('[role="dialog"]') || !item.matches("a, button")).map((item) => item.textContent?.trim()),
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        overflow: document.documentElement.scrollWidth > innerWidth,
        navs: Array.from(element.querySelectorAll("nav")).filter((nav) => !nav.closest('[role="dialog"]')).map((nav) => {
          const style = getComputedStyle(nav);
          return { wrap: style.flexWrap, rowGap: style.rowGap, columnGap: style.columnGap };
        }),
        controls: controls.map((control) => {
          const box = control.getBoundingClientRect();
          const style = getComputedStyle(control);
          return {
            label: control.getAttribute("aria-label") ?? control.textContent?.trim(),
            left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height,
            clipped: control.scrollWidth > control.clientWidth + 1,
            fontSize: style.fontSize, fontWeight: style.fontWeight, radius: style.borderRadius,
            paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
          };
        }),
      };
    });
    expect(geometry.missing, `${surface}: unmarked header controls`).toEqual([]);
    expect(geometry.extra, `${surface}: non-navigation controls were marked`).toEqual([]);
    expect(geometry.overflow, `${surface} at ${width}px`).toBe(false);
    expect(geometry.navs).toEqual([{ wrap: "wrap", rowGap: "8px", columnGap: "8px" }]);
    expect(geometry.controls.length).toBeGreaterThan(1);
    for (const control of geometry.controls) {
      expect(control, `${surface}, ${control.label}, ${width}px`).toMatchObject({
        height: 40, fontSize: "13px", fontWeight: "500", radius: "12px", paddingLeft: "12px", paddingRight: "12px", clipped: false,
      });
      expect(control.left).toBeGreaterThanOrEqual(Math.max(0, geometry.left) - 1);
      expect(control.right).toBeLessThanOrEqual(Math.min(width, geometry.right) + 1);
      expect(control.top).toBeGreaterThanOrEqual(geometry.top - 1);
      expect(control.bottom).toBeLessThanOrEqual(geometry.bottom + 1);
    }
    for (const [index, control] of geometry.controls.entries()) {
      for (const other of geometry.controls.slice(index + 1)) {
        const overlapX = Math.min(control.right, other.right) - Math.max(control.left, other.left);
        const overlapY = Math.min(control.bottom, other.bottom) - Math.max(control.top, other.top);
        expect(overlapX > 1 && overlapY > 1, `${surface}: ${control.label} overlaps ${other.label} at ${width}px`).toBe(false);
      }
      const next = geometry.controls[index + 1];
      if (next && Math.abs(control.top - next.top) < 1) expect(next.left - control.right).toBeCloseTo(8, 0);
    }
    if (width === 390 || width === 1440) await page.screenshot({ path: `test-results/header-consistency/${surface}-${width}.png`, animations: "disabled" });
  }
}

/** Table header variants need only real projected state, not another full game lifecycle. */
async function tablePage(page: Page, code: string, playing: boolean, seated: boolean, profile?: Profile) {
  const ctx = makeCtx(4, Date.now() - 10_001);
  const initial = playing ? started(ctx) : table(ctx, 2);
  const state = initial.state;
  state.code = code;
  const me = seated ? initial.hostId : null;
  player(state, initial.hostId).name = profile?.displayName ?? "Table Navigator";
  if (profile) player(state, initial.hostId).profileId = profile.id;
  const seat = me ? { playerId: me, token: player(state, me).token!, name: player(state, me).name } : null;
  if (seat) await page.addInitScript(({ code, seat }) => {
    if (location.pathname === `/g/${code}`) localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat));
  }, { code, seat });
  const response = () => ({ view: projectFor(state, 1, me, Date.now()), me, seat, note: null });
  await page.route(`**/api/games/${code}/state`, (route) => route.fulfill({ json: response() }));
  await page.route(`**/api/games/${code}/actions`, (route) => route.fulfill({ json: response() }));
  await page.route(`**/api/games/${code}/nudge`, (route) => route.fulfill({ json: { ok: true } }));
  await page.route(`**/api/games/${code}/profiles`, (route) => route.fulfill({ json: { profiles: profile ? [{ id: profile.id, handle: profile.handle, points: profile.points }] : [] } }));
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await page.goto(`/g/${code}`);
  if (playing && !seated) await page.getByRole("button", { name: "Watch", exact: true }).click();
  if (playing) await expect(page.getByRole("region", { name: `${player(state, initial.hostId).name}'s hand`, exact: true })).toBeVisible();
  else await expect(page.getByRole("button", { name: seated ? "Start round" : "Take a seat", exact: true })).toBeVisible();
  const nav = header(page).getByRole("navigation", { name: "Table controls", exact: true });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("button", { name: "How to play", exact: true })).toBeVisible();
  await expect(nav.locator('[aria-current="page"]')).toHaveCount(0);
  if (profile) await expect(nav.getByRole("link", { name: "Account settings", exact: true })).toHaveAttribute("href", `/me?${new URLSearchParams({ from: `/g/${code}` })}`);
  if (seated) {
    await expect(nav.getByRole("switch", { name: "Do not disturb", exact: true })).toBeVisible();
    await expect(nav.getByRole("button", { name: "Leave", exact: true })).toBeVisible();
  } else await expect(nav.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/");
}

test("guest website headers keep navigation order, sizing, and login continuation", async ({ page, browser }) => {
  const owner = await browser.newContext({ baseURL: origin });
  try {
    const profile = await createAccount(owner);
    await page.goto("/");
    await expect(header(page).getByRole("link", { name: "Log in", exact: true })).toBeVisible();
    await websiteNavigation(page, false, "Tables");
    await auditHeader(page, "guest-home");
    await header(page).getByRole("link", { name: "Leaderboard", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Leaderboard", exact: true })).toBeVisible();
    await websiteNavigation(page, false, "Leaderboard");
    await expect(header(page).getByRole("link", { name: "Log in", exact: true })).toHaveAttribute("href", `/login?${new URLSearchParams({ next: "/leaderboard?scope=all" })}`);
    await auditHeader(page, "guest-leaderboard");
    await page.goto(`/p/${profile.handle}`);
    await expect(page.getByRole("heading", { name: profile.displayName, exact: true })).toBeVisible();
    await websiteNavigation(page, false, null);
    await auditHeader(page, "guest-profile");
    await header(page).getByRole("link", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/login?${new URLSearchParams({ next: `/p/${profile.handle}` })}`);
    await expect(page.getByRole("form", { name: "Log in", exact: true })).toBeVisible();
    await websiteNavigation(page, false, "Log in", "Back to the profile");
    await auditHeader(page, "guest-login");
    await header(page).getByRole("button", { name: "How to play", exact: true }).click();
    const rules = page.getByRole("dialog", { name: "How to play", exact: true });
    await expect(rules).toBeVisible();
    await expect(rules.locator("[data-header-control]")).toHaveCount(0);
    await rules.getByRole("button", { name: "Close", exact: true }).click();
    await header(page).getByRole("link", { name: "Back to the profile", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/p/${profile.handle}`);
  } finally { await owner.close(); }
});

test("account website headers preserve active links and the return from settings", async ({ page, context, browser }) => {
  const profile = await createAccount(context);
  const otherContext = await browser.newContext({ baseURL: origin });
  let other: Profile;
  try { other = await createAccount(otherContext); }
  finally { await otherContext.close(); }
  await page.goto("/");
  await expect(header(page).getByRole("link", { name: "Account settings", exact: true })).toBeVisible();
  await websiteNavigation(page, true, "Tables");
  await auditHeader(page, "account-home");
  await header(page).getByRole("link", { name: "Leaderboard", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Leaderboard", exact: true })).toBeVisible();
  await websiteNavigation(page, true, "Leaderboard");
  await auditHeader(page, "account-leaderboard");
  await header(page).getByRole("link", { name: "Your record", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/p/${profile.handle}`);
  await expect(page.getByRole("heading", { name: profile.displayName, exact: true })).toBeVisible();
  await websiteNavigation(page, true, "Your record");
  await auditHeader(page, "account-profile");
  await header(page).getByRole("link", { name: "Account settings", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
  await websiteNavigation(page, true, "Account settings", "Back to the profile");
  await auditHeader(page, "account-settings");
  await expect(header(page).getByRole("link", { name: "Back to the profile", exact: true })).toHaveAttribute("href", `/p/${profile.handle}`);
  await header(page).getByRole("link", { name: "Back to the profile", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/p/${profile.handle}`);
  await page.goto(`/p/${other.handle}`);
  await expect(page.getByRole("heading", { name: other.displayName, exact: true })).toBeVisible();
  await websiteNavigation(page, true, null);
  await expect(header(page).getByRole("link", { name: "Your record", exact: true })).toHaveAttribute("href", `/p/${profile.handle}`);
  await auditHeader(page, "account-other-profile");
});

for (const mode of ["guest", "account"] as const) {
  test(`${mode} direct join, spectator, lobby, and game share the header control geometry`, async ({ page, context }) => {
    const profile = mode === "account" ? await createAccount(context) : undefined;
    for (const [code, playing, seated, surface] of [
      ["HDR01", false, false, "direct-join"], ["HDR02", true, false, "spectator"],
      ["HDR03", false, true, "lobby"], ["HDR04", true, true, "playing"],
    ] as const) {
      await tablePage(page, code, playing, seated, profile);
      await auditHeader(page, `${mode}-${surface}`);
    }
    if (profile) {
      await header(page).getByRole("link", { name: "Account settings", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Account settings", exact: true })).toBeVisible();
      await expect(header(page).getByRole("link", { name: "Back to the table", exact: true })).toHaveAttribute("href", "/g/HDR04");
      await header(page).getByRole("link", { name: "Back to the table", exact: true }).click();
      await expect(page).toHaveURL(`${origin}/g/HDR04`);
      await expect(header(page).getByRole("button", { name: "Leave", exact: true })).toBeVisible();
    }
  });
}
