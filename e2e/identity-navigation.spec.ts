import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { act, card, makeCtx, player, rigDeck, started } from "../src/lib/game/testkit";
import { projectFor } from "../src/lib/game/view";
import type { Profile } from "../src/lib/social/types";

function profile(id: string): Profile {
  return {
    id, handle: id, displayName: id === "viewerone" ? "First Viewer" : id === "viewertwo" ? "Second Viewer" : "Table Friend",
    avatarId: 0, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), lastPlayedAt: null,
    points: 0, rank: 1, totalPlayers: 3, roundsPlayed: 0, roundsWon: 0, tablesPlayed: 0, scoreTotal: 0,
    bestScore: null, cambioCalls: 0, cambioWins: 0, sticksHit: 0, sticksMissed: 0, currentStreak: 0, bestStreak: 0,
  };
}

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/** Exercise the real account storage listener while keeping responses deterministic. */
async function viewers(context: BrowserContext, page: Page) {
  let current: Profile | null = profile("viewerone");
  const blank = { friends: [], incoming: [], outgoing: [], invites: [], sent: [], joinRequests: [], sentJoinRequests: [], opponents: [] };
  await context.addInitScript((initial) => {
    if (!localStorage.getItem("cambio:profile")) localStorage.setItem("cambio:profile", JSON.stringify({ token: `account:${initial.id}`, profile: initial, username: initial.handle }));
    localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
  }, current);
  await context.route("**/api/account", (route) => route.fulfill({ json: { profile: current, username: current?.handle ?? null } }));
  await context.route("**/api/social", (route) => route.fulfill({ json: { profile: current, social: blank, channel: null } }));
  await context.route("**/api/presence", (route) => route.fulfill({ json: { ok: true } }));
  await page.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  const controller = await context.newPage();
  await controller.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
  await controller.goto("/");
  return {
    current: () => current,
    controller,
    async switchTo(next: Profile | null) {
      current = next;
      await controller.evaluate((value) => {
        if (value) localStorage.setItem("cambio:profile", JSON.stringify({ token: `account:${value.id}`, profile: value, username: value.handle }));
        else localStorage.removeItem("cambio:profile");
        localStorage.setItem("cambio:session-revision", crypto.randomUUID());
      }, next);
    },
  };
}

test("a delayed profile response cannot show the previous viewer's friendship or shared rounds", async ({ context, page }) => {
  const accounts = await viewers(context, page);
  const oldRead = gate(), oldCaptured = gate(), oldDelivered = gate();
  const target = profile("tablefriend");
  await page.route("**/api/profile/tablefriend", async (route) => {
    const previousViewer = accounts.current()?.id === "viewerone";
    if (previousViewer) { oldCaptured.release(); await oldRead.promise; }
    await route.fulfill({ json: { profile: target, relation: previousViewer ? "friends" : "none", playedTogether: previousViewer ? 9 : 0 } });
    if (previousViewer) oldDelivered.release();
  });
  try {
    await page.goto("/p/tablefriend");
    await oldCaptured.promise;
    await accounts.switchTo(profile("viewertwo"));
    await expect(page.getByRole("button", { name: "Add friend", exact: true })).toBeVisible();
    oldRead.release();
    await oldDelivered.promise;
    await expect(page.getByRole("button", { name: "Add friend", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove friend", exact: true })).toHaveCount(0);
    await expect(page.getByText("9 rounds across the table from you")).toHaveCount(0);
  } finally { oldRead.release(); await accounts.controller.close(); }
});

test("switching accounts hides already loaded friendship details while the next viewer is loading", async ({ context, page }) => {
  const accounts = await viewers(context, page);
  const nextRead = gate(), nextCaptured = gate();
  await page.route("**/api/profile/tablefriend", async (route) => {
    const previousViewer = accounts.current()?.id === "viewerone";
    if (!previousViewer) { nextCaptured.release(); await nextRead.promise; }
    await route.fulfill({ json: { profile: profile("tablefriend"), relation: previousViewer ? "friends" : "none", playedTogether: previousViewer ? 9 : 0 } });
  });
  try {
    await page.goto("/p/tablefriend");
    await expect(page.getByRole("button", { name: "Remove friend", exact: true })).toBeVisible();
    await accounts.switchTo(profile("viewertwo"));
    await nextCaptured.promise;
    await expect(page.getByRole("button", { name: "Remove friend", exact: true })).toHaveCount(0);
    await expect(page.getByText("9 rounds across the table from you")).toHaveCount(0);
    nextRead.release();
    await expect(page.getByRole("button", { name: "Add friend", exact: true })).toBeVisible();
  } finally { nextRead.release(); await accounts.controller.close(); }
});

for (const nextId of ["viewertwo", null] as const) {
  test(`${nextId ? "switching accounts" : "logging out"} immediately hides private cards despite delayed table responses`, async ({ context, page }) => {
    const accounts = await viewers(context, page);
    const ctx = makeCtx(41, Date.now() - 10_001);
    const game = started(ctx, 2);
    game.state.players[0].profileId = "viewerone";
    game.state.players[0].name = "First Viewer";
    game.state.players[1].profileId = "viewertwo";
    game.state.players[1].name = "Second Viewer";
    const state = act(rigDeck(game.state, [card("private-ace", "A", "S")]), game.hostId, { type: "draw" }, ctx);
    const seat = (id: string) => { const entry = player(state, id); return { playerId: entry.id, token: entry.token!, name: entry.name }; };
    await page.addInitScript(({ code, saved }) => localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(saved)), { code: state.code, saved: seat(game.hostId) });
    let holding = false;
    const oldRead = gate(), nextRead = gate(), oldCaptured = gate(), nextCaptured = gate(), oldDelivered = gate();
    await page.route(`**/api/games/${state.code}/state`, async (route) => {
      const viewer = accounts.current()?.id;
      const me = state.players.find((entry) => entry.profileId === viewer)?.id ?? null;
      const body = { view: projectFor(state, 1, me, Date.now()), me, seat: me ? seat(me) : null };
      if (holding) {
        if (viewer === "viewerone") { oldCaptured.release(); await oldRead.promise; }
        else { nextCaptured.release(); await nextRead.promise; }
      }
      await route.fulfill({ json: body });
      if (holding && viewer === "viewerone") oldDelivered.release();
    });
    await page.route(`**/api/games/${state.code}/profiles`, (route) => route.fulfill({ json: { profiles: [] } }));
    await page.route(`**/api/games/${state.code}/nudge`, (route) => route.fulfill({ json: { ok: true } }));
    await page.route(`**/api/games/${state.code}/actions`, (route) => route.fulfill({ json: { error: { code: "PAUSED", message: "Fixture is waiting." } }, status: 409 }));
    const actions = page.getByRole("region", { name: "Round actions", exact: true });
    try {
      await page.goto(`/g/${state.code}`);
      await expect(actions.getByText("A", { exact: true })).toBeVisible();
      holding = true;
      await oldCaptured.promise;
      await accounts.switchTo(nextId ? profile(nextId) : null);
      await nextCaptured.promise;
      // No current-identity state response has arrived yet.
      // Returning as a spectator must not reuse the former player's snapshot.
      await page.getByRole("button", { name: "Watch", exact: true }).click();
      await expect(actions).toBeVisible();
      await expect(actions.getByText("A", { exact: true })).toHaveCount(0);
      await expect(actions.getByRole("button", { name: /Place .* on the pile/ })).toHaveCount(0);
      nextRead.release();
      if (nextId) await expect(page.getByRole("region", { name: "Second Viewer's hand", exact: true }).getByText("You", { exact: true })).toBeVisible();
      oldRead.release();
      await oldDelivered.promise;
      await expect(actions.getByText("A", { exact: true })).toHaveCount(0);
      await expect(actions.getByRole("button", { name: /Place .* on the pile/ })).toHaveCount(0);
    } finally { oldRead.release(); nextRead.release(); await accounts.controller.close(); }
  });
}
