import { test, expect } from "@playwright/test";
import { makeCtx, player, started } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";

test("house bot faces stay fixed when opening different tables, including older saved seats", async ({ page }) => {
  const tables = [0, 13].map((offset, index) => {
    const ctx = makeCtx(7, Date.now() - 10_001);
    for (let i = 0; i < offset; i++) ctx.newId();
    const t = started(ctx, 1);
    t.state.code = `BOT0${index + 1}`;
    if (index === 1) for (const bot of t.state.players.filter((p) => p.isBot)) delete bot.avatarId;
    const host = player(t.state, t.hostId);
    return { ...t, seat: { playerId: host.id, token: host.token!, name: host.name } };
  });
  await page.addInitScript((tables) => {
    for (const t of tables) localStorage.setItem(`cambio:seat:${t.state.code}`, JSON.stringify(t.seat));
    localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
  }, tables);
  await page.route("**/api/account", (route) => route.fulfill({ json: { profile: null, username: null } }));
  for (const t of tables) {
    await page.route(`**/api/games/${t.state.code}/state`, (route) => route.fulfill({
      json: { view: projectFor(t.state, 1, t.hostId, Date.now()), me: t.hostId, seat: t.seat },
    }));
    await page.route(`**/api/games/${t.state.code}/nudge`, (route) => route.fulfill({ json: { ok: true } }));
  }
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  for (const t of tables) {
    await page.goto(`/g/${t.state.code}`);
    for (const [name, avatarId] of [["Cameron", 0], ["Camila", 1], ["Cami", 5]] as const) {
      const hand = page.getByRole("region", { name: `${name}'s hand`, exact: true });
      await expect(hand).toBeVisible();
      const avatar = hand.locator("[data-avatar-index]");
      await expect(avatar).toHaveAttribute("data-avatar-index", String(avatarId));
      await expect(avatar).toHaveAttribute("data-avatar-style", String(avatarId));
      await expect(avatar).toHaveAttribute("data-avatar-tone", "0");
      await expect.poll(() => avatar.locator("img").evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)).toBe(true);
    }
  }
  await page.screenshot({ path: "test-results/desktop/fixed-bot-avatars.png", fullPage: true, animations: "disabled" });
});
