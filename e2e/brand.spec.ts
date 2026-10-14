import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const HERO = '[data-logo-intro="hero"]';
const SCREENS = "docs/logo/screens";

/**
 * Motion still playing on elements inside `scope`, ignoring development
 * overlays and hover color fades, which do not move anything.
 */
function running(page: Page, scope: string) {
  return page.evaluate((selector) => {
    const roots = [...document.querySelectorAll(selector)];
    return document.getAnimations().filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (a instanceof CSSTransition && !["transform", "translate", "rotate", "scale"].includes(a.transitionProperty)) return false;
      return a.playState !== "finished" && a.playState !== "idle" && target instanceof Element
        && target.getRootNode() === document && roots.some((root) => root.contains(target));
    }).length;
  }, scope);
}

const settled = (page: Page, scope: string) => expect.poll(() => running(page, scope), { timeout: 10_000 }).toBe(0);
const dealing = (page: Page, scope: string) => expect.poll(() => running(page, scope), { timeout: 15_000, intervals: [25] }).toBeGreaterThan(0);
const hang = () => { /* Leave the request open, so the page stays in its loading state. */ };

test("the logo renders with its name, decorative cards, and every icon wired", async ({ page }) => {
  await page.goto("/");
  const hero = page.getByRole("img", { name: "Cambio" });
  await expect(hero).toBeVisible();
  await expect(hero.locator("[data-logo-card]")).toHaveCount(8);
  await expect(hero.locator("[data-logo-card]").first()).not.toHaveAttribute("role");
  expect(await hero.evaluate((el) => [...el.children].every((child) => child.getAttribute("aria-hidden") === "true"))).toBe(true);
  // Beside the word Cambio, the mark is decoration and is not announced twice.
  const header = page.getByRole("link", { name: "Cambio home" }).locator("[data-logo]");
  await expect(header).toHaveAttribute("aria-hidden", "true");

  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("sizes", "180x180");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/social\/cambio-share\.png$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  for (const path of ["/favicon.ico", "/icon.svg", "/icon1.png", "/icon2.png", "/apple-icon.png", "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest", "/social/cambio-share.png"]) {
    expect((await page.request.get(path)).status(), path).toBe(200);
  }
});

test("the dealt logo ends exactly on the static logo", async ({ page }) => {
  await page.goto("/");
  const hero = page.locator(HERO);
  await dealing(page, HERO);
  await settled(page, HERO);
  const dealt = await hero.screenshot();
  // Same session: the intro has played, so this is the static mode.
  await page.reload();
  await expect(hero).toBeVisible();
  expect(await running(page, HERO)).toBe(0);
  const still = await hero.screenshot();
  expect(dealt.equals(still)).toBe(true);
});

test("one time entrances do not replay later in the same session", async ({ page }) => {
  await page.goto("/");
  await dealing(page, HERO);
  await settled(page, HERO);
  await page.goto("/leaderboard");
  await page.goto("/");
  await expect(page.locator(HERO)).toBeVisible();
  await page.waitForTimeout(400);
  expect(await running(page, HERO)).toBe(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-intro");

  // The walkthrough deals its first step once.
  await page.getByRole("button", { name: "How to play" }).click();
  const art = page.getByRole("dialog", { name: "How Cambio works" }).locator(".grid").first();
  await dealing(page, '[role="dialog"] .grid');
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("button", { name: "How to play" }).click();
  await page.getByRole("button", { name: "Show walkthrough again" }).click();
  await expect(art).toBeVisible();
  await page.waitForTimeout(300);
  expect(await running(page, '[role="dialog"] .grid')).toBe(0);
});

test("the header logo never animates", async ({ page }) => {
  await page.goto("/");
  const mark = page.locator("[data-app-header] [data-logo]");
  await expect(mark).toHaveAttribute("data-logo", "static");
  await dealing(page, HERO);
  expect(await running(page, "[data-app-header] [data-logo]")).toBe(0);
  await mark.hover();
  expect(await running(page, "[data-app-header] [data-logo]")).toBe(0);
  await page.route("**/api/**", hang);
  await page.goto("/leaderboard");
  await expect(page.locator('[data-logo="loading"]')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await running(page, "[data-app-header] [data-logo]")).toBe(0);
});

test("reduced motion skips every logo and card animation", async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator(HERO)).toBeVisible();
  await page.waitForTimeout(500);
  expect(await running(page, "[data-logo]")).toBe(0);
  const opacities = await page.locator(`${HERO} [data-logo-card]`).evaluateAll((cards) => cards.map((c) => getComputedStyle(c).opacity));
  expect(opacities).toEqual(Array(8).fill("1"));
  await page.locator(HERO).click();
  expect(await running(page, "[data-logo]")).toBe(0);

  await page.getByRole("button", { name: "How to play" }).click();
  const dialog = page.getByRole("dialog", { name: "How Cambio works" });
  await expect(dialog).toBeVisible();
  expect(await running(page, '[role="dialog"]')).toBe(0);
  await page.getByRole("button", { name: "Next", exact: true }).click();
  expect(await running(page, '[role="dialog"]')).toBe(0);
  await page.getByRole("button", { name: "Skip", exact: true }).click();

  await page.route("**/api/**", hang);
  await page.goto("/leaderboard");
  await expect(page.locator('[data-logo="loading"]')).toBeVisible();
  await page.waitForTimeout(300);
  expect(await running(page, "[data-logo]")).toBe(0);
  await context.close();
});

test("the loading logo stays hidden for fast loads and never shifts layout", async ({ page }) => {
  await page.addInitScript(() => {
    const shifts: string[] = [];
    (window as unknown as { shifts: string[] }).shifts = shifts;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as { sources?: { node?: Node }[] }[]) {
        for (const source of entry.sources ?? []) {
          const node = source.node instanceof Element ? source.node : source.node?.parentElement;
          shifts.push(node?.closest("[data-logo]") ? "logo" : "other");
        }
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.route("**/api/**", hang);
  await page.goto("/leaderboard");
  const loader = page.locator('[data-logo="loading"]');
  await expect(loader).toBeAttached();
  await expect(loader).toBeHidden();
  const before = await loader.boundingBox();
  await expect(loader).toBeVisible();
  await dealing(page, '[data-logo="loading"]');
  expect(await loader.boundingBox()).toEqual(before);

  await page.unroute("**/api/**");
  await page.goto("/");
  const hero = page.locator(HERO);
  const start = await hero.boundingBox();
  await dealing(page, HERO);
  await settled(page, HERO);
  expect(await hero.boundingBox()).toEqual(start);
  expect(await page.evaluate(() => (window as unknown as { shifts: string[] }).shifts.filter((s) => s === "logo"))).toEqual([]);
});

test("saves the final logo at every icon size in light and dark themes", async ({ browser, baseURL }) => {
  mkdirSync(SCREENS, { recursive: true });
  for (const scheme of ["light", "dark"] as const) {
    const context = await browser.newContext({ colorScheme: scheme, deviceScaleFactor: 1 });
    const page = await context.newPage();
    await page.setContent(`<!doctype html><style>
      body { margin: 0; background: #ffffff; } @media (prefers-color-scheme: dark) { body { background: #202124; } }
      div { display: inline-flex; padding: 12px; }</style>
      ${[16, 32, 64, 180].map((s) => `<div id="s${s}"><img src="${baseURL}/icon.svg" width="${s}" height="${s}" alt="Cambio"></div>`).join("")}`);
    await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
    for (const size of [16, 32, 64, 180]) {
      const shot = await page.locator(`#s${size}`).screenshot({ path: `${SCREENS}/logo-${size}-${scheme}.png` });
      expect(shot.length).toBeGreaterThan(0);
    }
    await context.close();
  }
});

test("an account holder never sees the guest view before their own", async ({ page }) => {
  const profile = {
    id: "00000000-0000-4000-8000-000000000001", handle: "tester", displayName: "Tester", avatarId: null,
    createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z", lastPlayedAt: null,
    points: 0, rank: 1, totalPlayers: 1, roundsPlayed: 0, roundsWon: 0, tablesPlayed: 0, scoreTotal: 0, bestScore: null,
    cambioCalls: 0, cambioWins: 0, sticksHit: 0, sticksMissed: 0, currentStreak: 0, bestStreak: 0,
  };
  await page.addInitScript((stored) => {
    localStorage.setItem("cambio:profile", JSON.stringify(stored));
    const seen = { guest: false };
    (window as unknown as { seen: typeof seen }).seen = seen;
    const look = () => {
      const guest = document.querySelector("[data-guest-view]");
      if (guest && guest.getClientRects().length) seen.guest = true;
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }, { token: `account:${profile.id}`, profile, username: "tester" });
  // Keep the saved account: the placeholder backend would otherwise end the session.
  await page.route("**/api/**", hang);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ready for a round?" })).toBeVisible();
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { seen: { guest: boolean } }).seen.guest)).toBe(false);
  // The hero intro is still waiting for whenever a guest view is shown.
  expect(await page.evaluate(() => sessionStorage.getItem("cambio:seen:hero"))).toBeNull();
});
