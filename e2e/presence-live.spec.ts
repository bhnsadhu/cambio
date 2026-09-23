import { test, expect, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const password = "Live presence password 42!";
const post = (context: BrowserContext, path: string, data: unknown) => context.request.post(path, { headers: { origin }, data });
function sql(query: string) {
  const db = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(db)) throw new Error("Use the isolated test database.");
  return execFileSync("docker", ["exec", "-i", db, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-At"], { input: query, encoding: "utf8" }).trim();
}
async function account(browser: Browser, displayName: string) {
  const context = await browser.newContext({ baseURL: origin });
  const username = `live${randomBytes(5).toString("hex")}`;
  const response = await post(context, "/api/account", { username, displayName, password });
  expect(response.status()).toBe(201);
  return { context, username, profile: (await response.json()).profile };
}
async function friends(browser: Browser) {
  const actor = await account(browser, "Visible Friend");
  const observer = await account(browser, "Presence Observer");
  await post(observer.context, "/api/social/friends", { username: actor.username });
  await post(actor.context, "/api/social/friends/respond", { profileId: observer.profile.id, accept: true });
  return { actor, observer };
}
const row = (page: Page, name = "Visible Friend") => page.getByRole("link", { name, exact: true }).locator("xpath=ancestor::li");
async function status(page: Page, online: boolean, name = "Visible Friend") {
  await expect(row(page, name).getByText(online ? "Online" : "Offline", { exact: true })).toBeVisible({ timeout: 5000 });
}
async function openDocument(page: Page, path = "/") {
  const heartbeat = page.waitForResponse((response) => response.url().endsWith("/api/presence") && response.request().postDataJSON()?.online === true);
  await page.goto(path);
  expect((await heartbeat).ok()).toBe(true);
}

test("visible friend status follows closing, other tabs, route changes, BFCache and connection recovery without a realtime server", async ({ browser }) => {
  const { actor, observer } = await friends(browser);
  const watching = await observer.context.newPage();
  const page = await actor.context.newPage();
  try {
    await watching.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
    await watching.goto("/");
    await status(watching, false);
    await openDocument(page);
    await status(watching, true);
    const second = await actor.context.newPage();
    await openDocument(second, "/me");
    await page.goto("about:blank");
    await watching.waitForResponse((response) => response.url().endsWith("/api/social"));
    await status(watching, true);
    await second.close();
    await status(watching, false);
    await openDocument(page, "/leaderboard");
    await status(watching, true);
    const departures: unknown[] = [];
    page.on("request", (request) => {
      if (request.url().endsWith("/api/presence") && request.postDataJSON()?.online === false) departures.push(request.postDataJSON());
    });
    await page.getByRole("link", { name: "Cambio home", exact: true }).click();
    await expect(page).toHaveURL(`${origin}/`);
    expect(departures).toHaveLength(0);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await status(watching, false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await status(watching, true);
    await actor.context.setOffline(true);
    // A lost network cannot deliver a departure. Advance only the server's
    // lease fixture to exercise the same 75s crash bound without a long sleep.
    sql(`update public.presence set updated_at = now() - interval '76 seconds' where profile_id = '${actor.profile.id}';`);
    await status(watching, false);
    await actor.context.setOffline(false);
    await status(watching, true);
    await page.goto("/me");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await status(watching, false);
  } finally { await actor.context.close(); await observer.context.close(); }
});

test("database presence signals update the visible friend immediately through realtime while observer polling is paused", async ({ browser }) => {
  const { actor, observer } = await friends(browser);
  const watching = await observer.context.newPage();
  const page = await actor.context.newPage();
  let emit: ((revision: number) => void) | null = null;
  let reads = 0;
  watching.on("response", (response) => { if (response.url().endsWith("/api/social")) reads++; });
  try {
    const snapshot = await (await observer.context.request.get("/api/social")).json();
    const channel = snapshot.channel as string;
    const revision = () => Number(sql(`select revision from public.social_signals where channel_id = '${channel}';`));
    await watching.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => {
      socket.onMessage((data) => {
        const message = JSON.parse(data.toString());
        const array = Array.isArray(message);
        const [joinRef, ref, topic, event, payload] = array ? message : [message.join_ref, message.ref, message.topic, message.event, message.payload];
        const send = (name: string, body: object) => socket.send(JSON.stringify(array ? [joinRef, ref, topic, name, body] : { join_ref: joinRef, ref, topic, event: name, payload: body }));
        if (event === "phx_join") {
          const filters = payload.config.postgres_changes.map((filter: object) => ({ ...filter, id: 42 }));
          send("phx_reply", { status: "ok", response: { postgres_changes: filters } });
          if (topic === `realtime:social:${channel}`) emit = (value) => send("postgres_changes", { ids: [42], data: {
            schema: "public", table: "social_signals", type: "UPDATE", commit_timestamp: new Date().toISOString(),
            columns: [{ name: "channel_id", type: "uuid" }, { name: "revision", type: "int8" }],
            record: { channel_id: channel, revision: value }, old_record: {}, errors: null,
          } });
        } else if (event === "heartbeat" || event === "phx_leave") send("phx_reply", { status: "ok", response: {} });
      });
    });
    await watching.goto("/");
    await status(watching, false);
    await expect.poll(() => emit !== null).toBe(true);
    await expect.poll(() => reads).toBeGreaterThanOrEqual(2);
    const frozenAt = new Date();
    await watching.clock.install({ time: frozenAt });
    await watching.clock.pauseAt(frozenAt);
    const before = revision();
    await openDocument(page);
    await expect.poll(revision).toBeGreaterThan(before);
    await status(watching, false);
    emit!(revision());
    await status(watching, true);
    const joined = revision();
    await page.close();
    await expect.poll(revision).toBeGreaterThan(joined);
    await status(watching, true);
    emit!(revision());
    await status(watching, false);
  } finally { await actor.context.close(); await observer.context.close(); }
});

test("account switching rejects delayed heartbeats from the previous identity without showing the next account online", async ({ browser }) => {
  const { actor, observer } = await friends(browser);
  const next = await account(browser, "Next Account");
  const watching = await observer.context.newPage();
  const page = await actor.context.newPage();
  try {
    await post(observer.context, "/api/social/friends", { username: next.username });
    await post(next.context, "/api/social/friends/respond", { profileId: observer.profile.id, accept: true });
    await post(next.context, "/api/account/logout", {});
    await watching.routeWebSocket(/\/realtime\/v1\/websocket/, (socket) => socket.close());
    await watching.goto("/");
    await status(watching, false);
    await status(watching, false, "Next Account");
    const beat = page.waitForRequest((request) => request.url().endsWith("/api/presence") && request.postDataJSON()?.online === true);
    await openDocument(page);
    const old = (await beat).postDataJSON();
    await status(watching, true);
    expect((await post(actor.context, "/api/account/login", { username: next.username, password })).ok()).toBe(true);
    expect((await post(actor.context, "/api/presence", { ...old, sequence: old.sequence + 100, online: true })).ok()).toBe(true);
    await status(watching, false);
    await status(watching, false, "Next Account");
    expect(sql(`select count(*) from public.presence where profile_id = '${next.profile.id}';`)).toBe("0");
    await openDocument(page, "/me");
    await status(watching, true, "Next Account");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await status(watching, false, "Next Account");
  } finally { await actor.context.close(); await observer.context.close(); await next.context.close(); }
});
