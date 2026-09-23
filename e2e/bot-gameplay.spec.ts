import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { assessCambio } from "../src/lib/game/bots";
import { card, makeCtx, player, rig, rigDeck, started } from "../src/lib/game/testkit";
import { projectPublic } from "../src/lib/game/view";
import type { BotDifficulty, GameState, LogEntry } from "../src/lib/game/types";

const origin = process.env.E2E_APP_ORIGIN ?? "http://localhost:3100";
const restOrigin = process.env.E2E_REST_ORIGIN ?? "";
const tiers: BotDifficulty[] = ["easy", "medium", "hard"];
const createdCodes: string[] = [];

function isolatedDatabase() {
  const database = process.env.E2E_DB_CONTAINER ?? "";
  if (!/^cambio-e2e-db-\d+$/.test(database) || !/^http:\/\/127\.0\.0\.1:\d+$/.test(restOrigin)) {
    throw new Error("Run with test:accounts and its isolated database.");
  }
  return database;
}

async function rpc<T>(name: string, values: Record<string, unknown>): Promise<T> {
  isolatedDatabase();
  const response = await fetch(`${restOrigin}/rpc/${name}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ p_secret: "account-test-secret", ...values }),
  });
  expect(response.ok, await response.clone().text()).toBe(true);
  return response.json() as Promise<T>;
}

async function load(code: string): Promise<GameState> {
  const rows = await rpc<{ state: GameState }[]>("game_load", { p_code: code });
  expect(rows).toHaveLength(1);
  return rows[0].state;
}

function removeTables() {
  if (!createdCodes.length) return;
  const database = isolatedDatabase();
  const codes = createdCodes.splice(0);
  if (codes.some((code) => !/^[A-F0-9]{5}$/.test(code))) throw new Error("Unexpected fixture code.");
  execFileSync("docker", ["exec", "-i", database, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: `delete from public.games where code in (${codes.map((code) => `'${code}'`).join(",")});`, encoding: "utf8",
  });
}

test.afterEach(removeTables);

function base(tier: BotDifficulty) {
  const ctx = makeCtx(31, Date.now() - 10_001);
  const fixture = started(ctx, 1);
  fixture.state.code = randomBytes(3).toString("hex").slice(0, 5).toUpperCase();
  fixture.state.log = [];
  fixture.state.logSeq = 0;
  fixture.state.appliedActionIds = [];
  fixture.state.reveals = [];
  fixture.state.dealingUntil = null;
  fixture.state.openingPeekUntil = null;
  fixture.state.turnsTaken = 12;
  fixture.state.botHints = {};
  for (const bot of fixture.state.players.filter((p) => p.isBot)) {
    bot.difficulty = tier;
    fixture.state.botDifficulty[bot.seat] = tier;
    fixture.state.botKnown[bot.id] = [];
  }
  const actor = fixture.state.players.find((p) => p.name === "Cameron")!;
  fixture.state.turn = { playerId: actor.id, stage: "draw", drawnCardId: null, startedAt: Date.now() };
  return { ...fixture, actorId: actor.id };
}

function relativeHand(tier: BotDifficulty, winning: boolean) {
  const fixture = base(tier);
  let state = fixture.state;
  for (const p of state.players) {
    const hand = p.id === fixture.actorId
      ? winning ? [card(`own-0`, "9", "S"), card(`own-1`, "9", "H")]
        : [card(`own-0`, "3", "S"), card(`own-1`, "3", "H")]
      : !winning && p.id === fixture.hostId
        ? [card(`leader-0`, "A", "S"), card(`leader-1`, "A", "H")]
        : [card(`${p.id}-0`, "10"), card(`${p.id}-1`, "J"), card(`${p.id}-2`, "Q"), card(`${p.id}-3`, "10", "H")];
    state = rig(state, p.id, hand);
  }
  // This controlled decision fixture supplies observed faces explicitly. The
  // separate memory tests cover how each tier acquires and forgets them.
  state.botKnown[fixture.actorId] = state.players.flatMap((p) => p.hand.filter((id): id is string => id !== null));
  state = rigDeck(state, Array.from({ length: 8 }, (_, i) => card(`safe-final-draw-${i}`, "6")));
  return { ...fixture, state };
}

async function openAndRun(page: Page, state: GameState, hostId: string) {
  const now = Date.now();
  state.updatedAt = now;
  state.turn!.startedAt = now;
  await rpc("game_create", { p_code: state.code, p_state: state, p_view: projectPublic(state, 1, now) });
  createdCodes.push(state.code);
  const host = player(state, hostId);
  const seat = { playerId: hostId, token: host.token!, name: host.name };
  await page.addInitScript(({ code, seat }) => {
    localStorage.setItem(`cambio:seat:${code}`, JSON.stringify(seat));
    localStorage.setItem("cambio:prefs", JSON.stringify({ onboarded: true, sawPeekHint: true, sawPowerHint: true }));
  }, { code: state.code, seat });
  await page.goto(`/g/${state.code}`);
  for (const [name, avatar] of [["Cameron", 0], ["Camila", 1], ["Cami", 5]] as const) {
    const hand = page.getByRole("region", { name: `${name}'s hand`, exact: true });
    await expect(hand).toBeVisible();
    await expect(hand.locator("[data-avatar-index]")).toHaveAttribute("data-avatar-index", String(avatar));
  }
  // The real watchdog endpoint starts the unchanged production runner. No
  // game API, clock, random source, lease, or action delay is mocked.
  const response = await page.request.post(`/api/games/${state.code}/nudge`, { headers: { origin } });
  expect(response.status()).toBe(202);
  return now;
}

async function waitForLog(code: string, predicate: (entry: LogEntry) => boolean, timeout = 20_000) {
  await expect.poll(async () => (await load(code)).log.some(predicate), { timeout, intervals: [250, 500] }).toBe(true);
  return load(code);
}

for (const tier of tiers) {
  test(`${tier} runner draws when behind, calls on an 18-versus-40 lead, and finishes the live round`, async ({ page }, info) => {
    test.setTimeout(150_000);
    const losing = relativeHand(tier, false);
    const losingAssessment = assessCambio(losing.state, losing.actorId);
    expect(losingAssessment).toMatchObject({ call: false, ownEstimate: 6, unknownOwn: 0 });
    expect(losingAssessment.strongestOpponent).toBeLessThan(losingAssessment.ownEstimate);
    const losingStarted = await openAndRun(page, losing.state, losing.hostId);
    const drew = await waitForLog(losing.state.code, (entry) => entry.actorId === losing.actorId && entry.kind === "draw");
    const firstAction = drew.log.find((entry) => entry.actorId === losing.actorId)!;
    expect(firstAction.kind).toBe("draw");
    expect(firstAction.at - losingStarted).toBeGreaterThanOrEqual(1200);
    expect(drew.log.some((entry) => entry.actorId === losing.actorId && entry.kind === "cambio")).toBe(false);
    expect(drew.appliedActionIds.some((id) => id.startsWith("bot-"))).toBe(true);
    await page.goto("/");
    removeTables();

    const winning = relativeHand(tier, true);
    const winningAssessment = assessCambio(winning.state, winning.actorId);
    expect(winningAssessment).toMatchObject({ call: true, ownEstimate: 18, unknownOwn: 0 });
    expect(winningAssessment.strongestOpponent).toBeGreaterThan(winningAssessment.ownEstimate);
    expect(winningAssessment.winChance).toBeGreaterThanOrEqual(0.64);
    await openAndRun(page, winning.state, winning.hostId);
    const called = await waitForLog(winning.state.code, (entry) => entry.actorId === winning.actorId && entry.kind === "cambio");
    expect(called.cambio?.callerId).toBe(winning.actorId);
    expect(called.log.find((entry) => entry.actorId === winning.actorId)?.kind).toBe("cambio");
    await expect(page.getByRole("complementary", { name: "Table log", exact: true })).toContainText("Cameron called Cambio");

    // Camila and Cami finish their actual final turns at normal production
    // pace. The one human then plays through the visible browser controls.
    const actions = page.getByRole("region", { name: "Round actions", exact: true });
    await expect(actions.getByRole("button", { name: "Draw", exact: true })).toBeVisible({ timeout: 80_000 });
    await actions.getByRole("button", { name: "Draw", exact: true }).click();
    await actions.getByRole("button", { name: /^Place .* on the pile$/ }).click();
    const results = page.getByRole("dialog", { name: "Round results", exact: true });
    await expect(results).toBeVisible({ timeout: 30_000 });
    const finished = await load(winning.state.code);
    expect(finished.phase).toBe("scoring");
    expect(finished.results).toHaveLength(1);
    expect(finished.results[0].scores).toHaveLength(4);
    for (const name of ["Camila", "Cami"]) {
      const bot = finished.players.find((p) => p.name === name)!;
      expect(finished.log.some((entry) => entry.actorId === bot.id && entry.kind === "draw")).toBe(true);
      expect(finished.log.some((entry) => entry.actorId === bot.id && ["place", "swap"].includes(entry.kind))).toBe(true);
    }
    // Count-up uses requestAnimationFrame, so screenshot animation disabling
    // alone cannot prove the final totals are rendered correctly.
    for (const score of finished.results[0].scores) {
      const name = player(finished, score.playerId).name;
      const row = results.locator("tbody tr").filter({ has: page.getByText(name, { exact: true }) });
      await expect(row.locator("td").nth(3)).toHaveText(String(score.score));
    }
    await page.screenshot({ path: info.outputPath(`${tier}-runner-scoring.png`), fullPage: true, animations: "disabled" });
    const evidencePath = info.outputPath(`${tier}-actual-runner-evidence.json`);
    writeFileSync(evidencePath, JSON.stringify({ losingAssessment, losingAction: firstAction, winningAssessment, finalLog: finished.log, result: finished.results[0] }, null, 2));
    await info.attach(`${tier}-actual-runner-evidence`, {
      path: evidencePath, contentType: "application/json",
    });
  });
}

test("the live tiers resolve the same drawn nine with different tactics and real power actions", async ({ page }, info) => {
  test.setTimeout(90_000);
  const outcomes: Record<string, unknown> = {};
  for (const tier of tiers) {
    const fixture = base(tier);
    let state = fixture.state;
    state = rig(state, fixture.actorId, [card("own-a", "A"), card("own-2", "2"), card("own-3", "3"), card("own-4", "4")]);
    state = rig(state, fixture.hostId, [card("leader-red-king", "K", "H"), card("leader-2", "2"), card("leader-3", "3"), card("leader-4", "4")]);
    for (const other of state.players.filter((p) => p.id !== fixture.actorId && p.id !== fixture.hostId)) {
      state = rig(state, other.id, [card(`${other.id}-10`, "10"), card(`${other.id}-j`, "J"), card(`${other.id}-q`, "Q"), card(`${other.id}-8`, "8")]);
    }
    state.botKnown[fixture.actorId] = [...player(state, fixture.actorId).hand.filter((id): id is string => !!id), "leader-red-king"];
    state.cards["choice-nine"] = card("choice-nine", "9");
    state.turn = { playerId: fixture.actorId, stage: "decide", drawnCardId: "choice-nine", startedAt: Date.now() };
    await openAndRun(page, state, fixture.hostId);
    const moved = await waitForLog(state.code, (entry) => entry.actorId === fixture.actorId && ["place", "swap"].includes(entry.kind));
    const decision = moved.log.find((entry) => entry.actorId === fixture.actorId && ["place", "swap"].includes(entry.kind))!;
    let completed = moved;
    if (tier === "hard") {
      expect(decision.kind).toBe("swap");
      expect(decision.subjectIds).toEqual([fixture.hostId]);
      expect(player(moved, fixture.hostId).hand).toContain("choice-nine");
      expect(moved.discard).toContain("leader-red-king");
    } else if (tier === "medium") {
      expect(decision.kind).toBe("place");
      completed = await waitForLog(state.code, (entry) => entry.actorId === fixture.actorId && entry.kind === "peekOther");
      const power = completed.log.find((entry) => entry.actorId === fixture.actorId && entry.kind === "peekOther")!;
      expect(power.cardIds).toEqual(["leader-2"]);
    } else {
      // Easy's normal production randomness may keep the nine in its own
      // hand or place it; it does not make hard's targeted attack.
      expect(["place", "swap"]).toContain(decision.kind);
      if (decision.kind === "swap") expect(decision.subjectIds).toEqual([fixture.actorId]);
      else completed = await waitForLog(state.code, (entry) => entry.actorId === fixture.actorId && ["peekOther", "skipPower"].includes(entry.kind));
    }
    outcomes[tier] = { decision, log: completed.log };
    await page.screenshot({ path: info.outputPath(`${tier}-drawn-nine.png`), fullPage: true, animations: "disabled" });
    await page.goto("/");
    removeTables();
  }
  const evidencePath = info.outputPath("same-card-live-tier-decisions.json");
  writeFileSync(evidencePath, JSON.stringify(outcomes, null, 2));
  await info.attach("same-card-live-tier-decisions", { path: evidencePath, contentType: "application/json" });
});
