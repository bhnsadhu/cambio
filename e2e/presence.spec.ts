import { test, expect, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const post = (context: BrowserContext, path: string, data: unknown) => context.request.post(path, { headers: { origin }, data });

test("presence follows open website tabs and ignores late heartbeats after departure", async ({ page, context, browser }) => {
  const username = `here${Math.random().toString(36).slice(2, 10)}`;
  const account = await (await post(context, "/api/account", { username, displayName: "Online Player", password: "eight888" })).json();
  const observer = await browser.newContext({ baseURL: origin });
  try {
    await post(observer, "/api/account", { username: `see${Math.random().toString(36).slice(2, 10)}`, displayName: "Observer", password: "eight888" });
    await post(observer, "/api/social/friends", { username });
    const requests = await (await context.request.get("/api/social")).json();
    await post(context, "/api/social/friends/respond", { profileId: requests.social.incoming[0].id, accept: true });
    const online = async () => {
      const result = await (await observer.request.get("/api/social")).json();
      return result.social.friends.find((friend: { id: string }) => friend.id === account.profile.id)?.online;
    };
    await page.goto("/");
    await expect.poll(online).toBe(true);
    const second = await context.newPage();
    const secondBeat = second.waitForResponse((response) => response.url().endsWith("/api/presence") && response.request().postDataJSON().online === true);
    await second.goto("/me");
    expect((await secondBeat).ok()).toBe(true);
    await page.goto("about:blank");
    await expect.poll(online).toBe(true);
    // pagehide also covers navigation to another website.
    await second.goto("about:blank");
    await expect.poll(online).toBe(false);
    await page.goto("/leaderboard");
    await expect.poll(online).toBe(true);
    // A cached page resumes the same document after pagehide.
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await expect.poll(online).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await expect.poll(online).toBe(true);
    await page.goto("about:blank");
    await expect.poll(online).toBe(false);
    const tabId = randomUUID();
    expect((await post(context, "/api/presence", { tabId, sequence: 2, online: false })).ok()).toBe(true);
    expect((await post(context, "/api/presence", { tabId, sequence: 1, online: true })).ok()).toBe(true);
    expect(await online()).toBe(false);
    expect((await post(context, "/api/presence", { tabId, sequence: 3, online: true })).ok()).toBe(true);
    expect(await online()).toBe(true);
    // Another device remains online when this device signs out.
    const device = await browser.newContext({ baseURL: origin });
    await post(device, "/api/account/login", { username, password: "eight888" });
    await post(device, "/api/presence", { tabId: randomUUID(), sequence: 1, online: true });
    await post(context, "/api/account/logout", {});
    expect(await online()).toBe(true);
    await post(device, "/api/account/logout", {});
    expect(await online()).toBe(false);
    await device.close();
    await second.close();
  } finally { await observer.close(); }
});
