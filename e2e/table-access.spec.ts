import { test, expect, type Browser, type BrowserContext } from "@playwright/test";
import { execFileSync } from "node:child_process";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const password = "A memorable table password 72!";
const post = (context: BrowserContext, path: string, data: unknown) => context.request.post(path, { headers: { origin }, data });
const snapshot = async (context: BrowserContext) => (await (await context.request.get("/api/social")).json()).social;
function sql(query: string) {
  const db = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(db)) throw new Error("Use the isolated test database.");
  return execFileSync("docker", ["exec", "-i", db, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: query, encoding: "utf8" }).trim();
}
async function account(browser: Browser, displayName: string) {
  const context = await browser.newContext({ baseURL: origin });
  const username = `table${Math.random().toString(36).slice(2, 10)}`;
  const response = await post(context, "/api/account", { username, displayName, password });
  expect(response.status()).toBe(201);
  return { context, profile: (await response.json()).profile, username };
}
async function setup(browser: Browser) {
  const host = await account(browser, "Table Host");
  const friend = await account(browser, "Joining Friend");
  await post(friend.context, "/api/social/friends", { username: host.username });
  await post(host.context, "/api/social/friends/respond", { profileId: friend.profile.id, accept: true });
  const seat = await (await post(host.context, "/api/games", {})).json();
  await post(host.context, "/api/presence", { code: seat.code });
  const social = await snapshot(friend.context);
  const tableId = social.friends[0].playing.tableId;
  expect(tableId).toBeTruthy();
  expect(social.friends[0].playing.code).toBeUndefined();
  expect(JSON.stringify(social)).not.toContain(seat.code);
  return { host, friend, seat, tableId };
}

test.beforeEach(() => sql("delete from private.auth_limits;"));

test("friends request a seat, receive a decision, and join only after approval", async ({ browser }) => {
  const { host, friend, seat, tableId } = await setup(browser);
  const hostPage = await host.context.newPage();
  const friendPage = await friend.context.newPage();
  try {
    await hostPage.goto(`/g/${seat.code}`);
    await hostPage.getByRole("button", { name: "Skip", exact: true }).click();
    await friendPage.goto("/");
    await expect(friendPage.getByRole("button", { name: "Ask to join", exact: true })).toBeVisible();
    await expect(friendPage.getByRole("button", { name: /Take a seat|Watch/ })).toHaveCount(0);
    await expect(friendPage.locator(`a[href="/g/${seat.code}"]`)).toHaveCount(0);
    await friendPage.getByRole("button", { name: "Ask to join", exact: true }).click();
    await expect(friendPage.getByRole("button", { name: "Request sent", exact: true })).toBeDisabled();
    await friendPage.reload();
    await expect(friendPage.getByRole("button", { name: "Request sent", exact: true })).toBeDisabled();
    const pending = (await snapshot(host.context)).joinRequests[0];
    expect((await (await post(friend.context, "/api/social/join-requests/respond", { requestId: pending.id, accept: true })).json()).outcome.ok).toBe(false);
    expect((await post(friend.context, `/api/games/${tableId}/join`, {})).status()).toBe(404);
    expect((await (await host.context.request.get(`/api/games/${seat.code}/state`)).json()).view.public.players).toHaveLength(1);
    const notice = hostPage.getByRole("region", { name: "Join request from Joining Friend" });
    await expect(notice).toBeVisible({ timeout: 15000 });
    await notice.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(notice).toHaveCount(0);
    sql(`update public.table_join_requests set created_at = now() - interval '61 seconds' where id = '${pending.id}';`);
    await friendPage.goto(`/p/${host.username}`);
    await expect(friendPage.getByText("Request declined", { exact: true })).toBeVisible();
    await expect(friendPage.getByRole("button", { name: "Take a seat" })).toHaveCount(0);
    await friendPage.getByRole("button", { name: "Ask again", exact: true }).click();
    await expect(notice).toBeVisible({ timeout: 15000 });
    await notice.getByRole("button", { name: "Accept", exact: true }).click();
    const invitation = friendPage.getByRole("region", { name: "Table invitation from Table Host" });
    await expect(invitation).toContainText("accepted your request", { timeout: 15000 });
    await friendPage.setViewportSize({ width: 390, height: 844 });
    await friendPage.screenshot({ path: "test-results/join-request-approved-mobile.png", fullPage: true });
    expect(await friendPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await invitation.getByRole("button", { name: "Join", exact: true }).click();
    await expect(friendPage).toHaveURL(`${origin}/g/${seat.code}`);
    await friendPage.getByRole("button", { name: "Skip", exact: true }).click();
    await expect(friendPage.getByRole("form", { name: "Join table" })).toHaveCount(0);
    await friendPage.reload();
    const state = await (await friend.context.request.get(`/api/games/${seat.code}/state`)).json();
    expect(state.me).toBeTruthy();
    expect(state.view.public.players).toHaveLength(2);
    expect((await snapshot(host.context)).joinRequests).toHaveLength(0);
  } finally { await host.context.close(); await friend.context.close(); }
});

test("direct invitations still work and shared codes invite guests", async ({ browser }) => {
  const { host, friend, seat } = await setup(browser);
  const guest = await browser.newContext({ baseURL: origin });
  const page = await friend.context.newPage();
  try {
    expect((await (await post(host.context, "/api/social/invites", { profileId: friend.profile.id, code: seat.code })).json()).outcome.ok).toBe(true);
    await page.goto("/");
    const invitation = page.getByRole("region", { name: "Table invitation from Table Host" });
    await expect(invitation).toContainText("invited you");
    await invitation.getByRole("button", { name: "No thanks", exact: true }).click();
    await expect(invitation).toHaveCount(0);
    sql(`update public.game_invites set created_at = now() - interval '61 seconds' where from_id = '${host.profile.id}';`);
    await post(host.context, "/api/social/invites", { profileId: friend.profile.id, code: seat.code });
    await page.reload();
    await invitation.getByRole("button", { name: "Join", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/g/${seat.code}`);
    expect((await post(guest, `/api/games/${seat.code}/join`, { name: "Invited by code" })).ok()).toBe(true);
    const state = await (await friend.context.request.get(`/api/games/${seat.code}/state`)).json();
    expect(state.view.public.players).toHaveLength(3);
    expect((await snapshot(friend.context)).invites).toHaveLength(0);
  } finally { await host.context.close(); await friend.context.close(); await guest.close(); }
});

test("join approval checks friendship, expiry, seats, and the friend's presence at the table", async ({ browser }) => {
  const { host, friend, seat, tableId } = await setup(browser);
  const outsider = await account(browser, "Other Player");
  const ask = async () => (await (await post(friend.context, "/api/social/join-requests", { profileId: host.profile.id, tableId })).json()).outcome;
  const answer = async (requestId: string) => (await (await post(host.context, "/api/social/join-requests/respond", { requestId, accept: true })).json()).outcome;
  try {
    const denied = await (await post(outsider.context, "/api/social/join-requests", { profileId: host.profile.id, tableId })).json();
    expect(denied.outcome.ok).toBe(false);
    await post(friend.context, "/api/presence", { code: seat.code });
    expect(JSON.parse(sql(`select public.presence_of('account-test-secret', '${friend.profile.id}');`)).code).toBeNull();
    expect((await ask()).ok).toBe(true);
    expect((await ask()).ok).toBe(false);
    let requests = (await snapshot(host.context)).joinRequests;
    expect(requests).toHaveLength(1);
    expect((await (await post(outsider.context, "/api/social/join-requests/respond", { requestId: requests[0].id, accept: true })).json()).outcome.ok).toBe(false);
    sql(`update public.table_join_requests set created_at = now() - interval '11 minutes' where id = '${requests[0].id}';`);
    expect((await answer(requests[0].id)).ok).toBe(false);
    expect((await snapshot(host.context)).joinRequests).toHaveLength(0);
    await ask();
    requests = (await snapshot(host.context)).joinRequests;
    expect(requests).toHaveLength(1);
    // A started table must not produce an invitation from an old request.
    await post(host.context, `/api/games/${seat.code}/actions`, { actionId: crypto.randomUUID(), action: { type: "start" } });
    expect((await answer(requests[0].id)).ok).toBe(false);
    expect((await snapshot(friend.context)).invites).toHaveLength(0);

    // A new table with a full set of humans is also refused at approval time.
    const second = await (await post(host.context, "/api/games", {})).json();
    await post(host.context, "/api/presence", { code: second.code });
    const secondId = (await snapshot(friend.context)).friends[0].playing.tableId;
    await post(friend.context, "/api/social/join-requests", { profileId: host.profile.id, tableId: secondId });
    const secondRequest = (await snapshot(host.context)).joinRequests[0];
    for (let i = 0; i < 3; i++) {
      const guest = await browser.newContext({ baseURL: origin });
      expect((await post(guest, `/api/games/${second.code}/join`, { name: `Shared guest ${i}` })).ok()).toBe(true);
      await guest.close();
    }
    expect((await answer(secondRequest.id)).ok).toBe(false);
    expect((await snapshot(friend.context)).invites).toHaveLength(0);
    await post(host.context, `/api/games/${second.code}/actions`, { actionId: crypto.randomUUID(), action: { type: "leaveTable" } });
    expect((await answer(secondRequest.id)).ok).toBe(false);
    expect((await snapshot(friend.context)).friends[0].playing).toBeNull();

    // Removing the friendship invalidates pending requests too.
    const third = await (await post(host.context, "/api/games", {})).json();
    await post(host.context, "/api/presence", { code: third.code });
    const thirdId = (await snapshot(friend.context)).friends[0].playing.tableId;
    await post(friend.context, "/api/social/join-requests", { profileId: host.profile.id, tableId: thirdId });
    const thirdRequest = (await snapshot(host.context)).joinRequests[0];
    await post(host.context, "/api/social/friends/remove", { profileId: friend.profile.id });
    expect((await answer(thirdRequest.id)).ok).toBe(false);
    expect((await snapshot(friend.context)).invites).toHaveLength(0);
  } finally { await host.context.close(); await friend.context.close(); await outsider.context.close(); }
});

test("invitations and join requests can be resent after one minute with one fresh notification", async ({ browser }) => {
  const { host, friend, seat, tableId } = await setup(browser);
  const hostPage = await host.context.newPage();
  const friendPage = await friend.context.newPage();
  try {
    await hostPage.goto(`/g/${seat.code}`);
    await hostPage.getByRole("button", { name: "Skip", exact: true }).click();
    await friendPage.goto("/");
    await friendPage.getByRole("button", { name: "Ask to join", exact: true }).click();
    await expect(friendPage.getByRole("button", { name: "Request sent", exact: true })).toBeDisabled();
    const first = (await snapshot(host.context)).joinRequests[0];
    const blocked = await (await post(friend.context, "/api/social/join-requests", { profileId: host.profile.id, tableId })).json();
    expect(blocked.outcome.ok).toBe(false);
    expect((await snapshot(host.context)).joinRequests).toHaveLength(1);
    sql(`update public.table_join_requests set created_at = now() - interval '61 seconds' where id = '${first.id}';`);
    await friendPage.reload();
    await friendPage.getByRole("button", { name: "Ask again", exact: true }).click();
    await expect(friendPage.getByRole("button", { name: "Request sent", exact: true })).toBeDisabled();
    const second = (await snapshot(host.context)).joinRequests;
    expect(second).toHaveLength(1);
    expect(second[0].id).not.toBe(first.id);
    expect((await (await post(host.context, "/api/social/join-requests/respond", { requestId: first.id, accept: true })).json()).outcome.ok).toBe(false);
    await post(host.context, "/api/social/join-requests/respond", { requestId: second[0].id, accept: false });
    await hostPage.getByRole("button", { name: "Invite", exact: true }).click();
    await expect(hostPage.getByRole("button", { name: "Invited", exact: true })).toBeDisabled();
    const firstInvite = (await snapshot(friend.context)).invites[0];
    const inviteBlocked = await (await post(host.context, "/api/social/invites", { profileId: friend.profile.id, code: seat.code })).json();
    expect(inviteBlocked.outcome).toMatchObject({ ok: false, reason: "cooldown" });
    sql(`update public.game_invites set created_at = now() - interval '61 seconds' where id = '${firstInvite.id}';`);
    await hostPage.reload();
    await hostPage.getByRole("button", { name: "Invite again", exact: true }).click();
    await expect(hostPage.getByRole("button", { name: "Invited", exact: true })).toBeDisabled();
    const secondInvite = (await snapshot(friend.context)).invites;
    expect(secondInvite).toHaveLength(1);
    expect(secondInvite[0].id).not.toBe(firstInvite.id);
    expect((await (await post(friend.context, "/api/social/invites/respond", { inviteId: firstInvite.id, accept: true })).json()).answer.ok).toBe(false);
    await friendPage.reload();
    await friendPage.getByRole("region", { name: "Table invitation from Table Host" }).getByRole("button", { name: "Join", exact: true }).click();
    await expect(friendPage).toHaveURL(`${origin}/g/${seat.code}`);
  } finally { await host.context.close(); await friend.context.close(); }
});
