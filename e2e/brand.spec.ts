import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const HERO = '[data-logo-intro="hero"]';
const SCREENS = "docs/logo/screens";
/** The hero renders one logo per breakpoint; this is the one on screen. */
const hero = (page: Page) => page.locator(`${HERO} >> visible=true`);

/**
 * Motion still playing on elements inside `scope`, ignoring development
 * overlays and hover color fades, which do not move anything. `once` counts
 * only motion that ends, leaving out loops such as the hero's breathing.
 */
function running(page: Page, scope: string, kind: "all" | "once" = "all") {
  return page.evaluate(([selector, which]) => {
    const roots = [...document.querySelectorAll(selector)];
    return document.getAnimations().filter((a) => {
      const target = (a.effect as KeyframeEffect | null)?.target;
      if (a instanceof CSSTransition && !["transform", "translate", "rotate", "scale"].includes(a.transitionProperty)) return false;
      if (which === "once" && a.effect?.getTiming().iterations === Infinity) return false;
      return a.playState !== "finished" && a.playState !== "idle" && target instanceof Element
        && target.getRootNode() === document && roots.some((root) => root.contains(target));
    }).length;
  }, [scope, kind] as const);
}

const settled = (page: Page, scope: string) => expect.poll(() => running(page, scope, "once"), { timeout: 15_000 }).toBe(0);
const dealing = (page: Page, scope: string) => expect.poll(() => running(page, scope, "once"), { timeout: 15_000, intervals: [25] }).toBeGreaterThan(0);
const looping = (page: Page, scope: string) => expect.poll(() => running(page, scope), { timeout: 15_000, intervals: [25] }).toBeGreaterThan(0);
/** Holds every loop at rest and hides the drifting background, so a frame can be compared. */
async function still(page: Page) {
  await page.addStyleTag({ content: "[data-hero-drift] { visibility: hidden !important; }" });
  await page.evaluate(() => { for (const a of document.getAnimations()) if (a.effect?.getTiming().iterations === Infinity) a.cancel(); });
  await page.waitForTimeout(100);
}
const hang = () => { /* Leave the request open, so the page stays in its loading state. */ };

test("the logo renders with its name, decorative cards, and every icon wired", async ({ page }) => {
  await page.goto("/");
  const mark = page.getByRole("img", { name: "Cambio" });
  await expect(mark).toBeVisible();
  await expect(mark.locator("[data-logo-card]")).toHaveCount(8);
  await expect(mark.locator("[data-logo-card]").first()).not.toHaveAttribute("role");
  expect(await mark.evaluate((el) => [...el.children].every((child) => child.getAttribute("aria-hidden") === "true"))).toBe(true);
  // Beside the word Cambio, the mark is decoration and is not announced twice.
  const header = page.getByRole("link", { name: "Cambio home" }).locator("[data-logo]");
  await expect(header).toHaveAttribute("aria-hidden", "true");

  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("sizes", "180x180");
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", /\/social\/cambio-share\.png(\?v=\d+)?$/);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
  for (const path of ["/favicon.ico", "/icon.svg", "/icon1.png", "/icon2.png", "/apple-icon.png", "/icons/icon-192.png", "/icons/icon-512.png", "/manifest.webmanifest", "/social/cambio-share.png"]) {
    expect((await page.request.get(path)).status(), path).toBe(200);
  }
});

test("the dealt logo ends exactly on the static logo", async ({ page }) => {
  await page.goto("/");
  await dealing(page, HERO);
  await settled(page, HERO);
  await still(page);
  const dealt = await hero(page).screenshot();
  // Same session: the intro has played, so this is the static mode.
  await page.reload();
  await expect(hero(page)).toBeVisible();
  expect(await running(page, HERO, "once")).toBe(0);
  await still(page);
  const rest = await hero(page).screenshot();
  expect(dealt.equals(rest)).toBe(true);
});

test("one time entrances do not replay later in the same session", async ({ page }) => {
  await page.goto("/");
  await dealing(page, HERO);
  await settled(page, HERO);
  await page.goto("/leaderboard");
  await page.goto("/");
  await expect(hero(page)).toBeVisible();
  await page.waitForTimeout(400);
  expect(await running(page, HERO, "once")).toBe(0);
  // It still breathes; only the deal is once per session.
  await looping(page, HERO);
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
  await expect(hero(page)).toBeVisible();
  await page.waitForTimeout(500);
  expect(await running(page, "[data-logo]")).toBe(0);
  expect(await running(page, "[data-hero-drift]")).toBe(0);
  expect(await running(page, '[aria-labelledby="hero-title"]')).toBe(0);
  const opacities = await hero(page).locator("[data-logo-card]").evaluateAll((cards) => cards.map((c) => getComputedStyle(c).opacity));
  expect(opacities).toEqual(Array(8).fill("1"));
  const line = page.locator('[aria-labelledby="hero-title"] p[aria-hidden]').first();
  const typed = await line.textContent();
  await hero(page).click();
  expect(await running(page, "[data-logo]")).toBe(0);
  await page.waitForTimeout(1500);
  expect(await line.textContent()).toBe(typed);

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
  await looping(page, '[data-logo="loading"]');
  expect(await loader.boundingBox()).toEqual(before);

  await page.unroute("**/api/**");
  await page.goto("/");
  const start = await hero(page).boundingBox();
  await dealing(page, HERO);
  await settled(page, HERO);
  expect(await hero(page).boundingBox()).toEqual(start);
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
  await expect(page.getByRole("list", { name: "Seats at a new table" })).toContainText("Tester");
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as unknown as { seen: { guest: boolean } }).seen.guest)).toBe(false);
  // The hero is shared, so account holders get the deal too.
  expect(await page.evaluate(() => sessionStorage.getItem("cambio:seen:hero"))).toBe("1");
});

test("an account holder's landing does not rearrange when the account check returns", async ({ page }) => {
  const profile = {
    id: "00000000-0000-4000-8000-000000000002", handle: "steady", displayName: "Steady", avatarId: null,
    createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z", lastPlayedAt: null,
    points: 0, rank: 1, totalPlayers: 1, roundsPlayed: 0, roundsWon: 0, tablesPlayed: 0, scoreTotal: 0, bestScore: null,
    cambioCalls: 0, cambioWins: 0, sticksHit: 0, sticksMissed: 0, currentStreak: 0, bestStreak: 0,
  };
  await page.addInitScript((stored) => localStorage.setItem("cambio:profile", JSON.stringify(stored)), { token: `account:${profile.id}`, profile, username: profile.handle });
  let release = () => {};
  const checked = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/account", async (route) => {
    await checked;
    await route.fulfill({ json: { profile, username: profile.handle } });
  });
  await page.route("**/api/social", (route) => route.fulfill({ json: { profile, social: { friends: [], incoming: [], outgoing: [], invites: [], sent: [], joinRequests: [], sentJoinRequests: [], opponents: [] }, channel: null } }));
  await page.route(/\/api\/(presence|games)/, hang);
  await page.goto("/");
  const card = page.getByRole("form", { name: "New table" });
  await expect(card).toBeVisible();
  const before = await card.boundingBox();
  await expect(page.getByRole("link", { name: "Your record" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open a table" })).toBeEnabled();
  release();
  await page.waitForResponse("**/api/account");
  await page.waitForTimeout(200);
  expect(await card.boundingBox()).toEqual(before);
});

/**
 * The landing page's alignment contract: the mark, the live line, the
 * headline and the blurb share one center axis; cards in a row share their top
 * and bottom edges; nothing leaves the viewport. Checked for guests and
 * account holders at phone, tablet and desktop widths.
 */
for (const account of [false, true]) {
  for (const width of [390, 768, 1024, 1440]) {
    test(`landing alignment holds for ${account ? "an account holder" : "a guest"} at ${width}px`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const profile = {
        id: "00000000-0000-4000-8000-000000000003", handle: "aligned", displayName: "Aligned", avatarId: 0,
        createdAt: "2026-01-01T00:00:00.000Z", lastSeenAt: "2026-01-01T00:00:00.000Z", lastPlayedAt: null,
        points: 0, rank: 1, totalPlayers: 1, roundsPlayed: 0, roundsWon: 0, tablesPlayed: 0, scoreTotal: 0, bestScore: null,
        cambioCalls: 0, cambioWins: 0, sticksHit: 0, sticksMissed: 0, currentStreak: 0, bestStreak: 0,
      };
      const social = { friends: [], incoming: [], outgoing: [], invites: [], sent: [], joinRequests: [], sentJoinRequests: [], opponents: [] };
      if (account) await context.addInitScript((stored) => localStorage.setItem("cambio:profile", JSON.stringify(stored)), { token: `account:${profile.id}`, profile, username: profile.handle });
      await context.route("**/api/**", (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({ json: !account ? {} : path === "/api/account" ? { profile, username: profile.handle } : path === "/api/social" ? { profile, social, channel: null } : {} });
      });
      const page = await context.newPage();
      await page.goto("/");
      await expect(page.getByRole("list", { name: "Seats at a new table" })).toBeVisible();
      await page.waitForTimeout(300);
      const m = await page.evaluate(() => {
        const rect = (el: Element | null) => { const r = el!.getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: (r.left + r.right) / 2 }; };
        const heroSection = document.querySelector('section[aria-labelledby="hero-title"]')!;
        const logo = [...heroSection.querySelectorAll("[data-logo]")].find((el) => el.getClientRects().length)!;
        const forms = [...document.querySelectorAll('[aria-label="Play Cambio"] > form')].map(rect);
        return {
          axis: rect(heroSection).cx,
          logo: rect(logo).cx,
          line: rect(heroSection.querySelector("p[aria-hidden]")).cx,
          title: rect(heroSection.querySelector("h1")).cx,
          forms,
          overflow: document.documentElement.scrollWidth > innerWidth,
          vw: innerWidth,
        };
      });
      expect(m.overflow).toBe(false);
      for (const key of ["logo", "line", "title"] as const) expect(Math.abs(m[key] - m.axis), key).toBeLessThanOrEqual(0.6);
      expect(m.forms).toHaveLength(2);
      for (const f of m.forms) { expect(f.l).toBeGreaterThanOrEqual(0); expect(f.r).toBeLessThanOrEqual(m.vw); }
      // Side by side: equal tops and bottoms. Stacked: same left and right edges.
      const [a, b] = m.forms;
      if (Math.abs(a.t - b.t) < 2) expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(0.6);
      else { expect(Math.abs(a.l - b.l)).toBeLessThanOrEqual(0.6); expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(0.6); }
      await context.close();
    });
  }
}
