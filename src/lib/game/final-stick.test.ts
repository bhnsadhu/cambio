import { describe, expect, it } from "vitest";
import { planBots } from "./bots";
import { applyAction, canStick, STICK_WINDOW_MS, TURN_TIMEOUT_MS } from "./engine";
import { act, card, makeCtx, player, rig, rigDeck, started } from "./testkit";
import { projectFor } from "./view";
import type { GameState, Rank } from "./types";

/** Play the caller and both preceding final turns; leave the last seat drawing. */
function lastTurn(hands: Rank[][] = [["5"], ["5", "2"], ["3"], ["5", "4"]]) {
  const ctx = makeCtx();
  const table = started(ctx);
  const ids = table.ids;
  let state = table.state;
  hands.forEach((ranks, seat) => {
    state = rig(state, ids[seat], ranks.map((rank, slot) => card(`p${seat}c${slot}`, rank)));
  });
  state = act(state, ids[0], { type: "callCambio" }, ctx);
  for (const id of [ids[1], ids[2]]) {
    state = rigDeck(state, [card(`before-${id}`, "K", "H")]);
    state = act(state, id, { type: "draw" }, ctx);
    state = act(state, id, { type: "place" }, ctx);
  }
  expect(state.turn?.playerId).toBe(ids[3]);
  expect(state.cambio?.remaining).toEqual([]);
  return { ctx, ids, state };
}

function placeLast(fixture: ReturnType<typeof lastTurn>, rank: Rank = "5") {
  const { ctx, ids } = fixture;
  let state = rigDeck(fixture.state, [card("final-draw", rank)]);
  state = act(state, ids[3], { type: "draw" }, ctx);
  return act(state, ids[3], { type: "place" }, ctx);
}

function timeout(state: GameState, ctx: ReturnType<typeof makeCtx>) {
  return act(state, state.players[0].id, { type: "timeout" }, ctx);
}

describe("final sticking window", () => {
  it.each([false, true])("always leaves a full window when a hidden match exists: %s", (matching) => {
    const fixture = lastTurn(matching ? undefined : [["A"], ["2"], ["3"], ["4"]]);
    const { ctx, ids } = fixture;
    let state = placeLast(fixture);
    expect(state.phase).toBe("final");
    expect(state.turn).toBeNull();
    expect(state.results).toEqual([]);
    expect(state.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
    expect(projectFor(state, 1, ids[0], ctx.now).public.stickWindowUntil).toBe(state.stickWindowUntil);
    ctx.tick(STICK_WINDOW_MS - 1);
    expect(timeout(state, ctx)).toBe(state);
    ctx.tick(1);
    state = timeout(state, ctx);
    expect(state.phase).toBe("scoring");
    expect(state.results).toHaveLength(1);
    expect(timeout(state, ctx)).toBe(state);
  });

  it.each([0, 1, 3])("accepts a last-placement stick by seat %i, including caller and final player", (seat) => {
    const fixture = lastTurn();
    const { ctx, ids } = fixture;
    let state = placeLast(fixture);
    ctx.tick(STICK_WINDOW_MS - 1);
    expect(canStick(state, ids[seat])).toBe(true);
    state = act(state, ids[seat], { type: "stick", cardId: `p${seat}c0` }, ctx);
    expect(player(state, ids[seat]).hand[0]).toBeNull();
    expect(state.phase).toBe("final");
    expect(state.results).toEqual([]);
    expect(state.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
  });

  it.each([1, 3])("gives the same window when the final drawn card replaces seat %i's card", (seat) => {
    const { ctx, ids, state: initial } = lastTurn();
    let state = rigDeck(initial, [card("replacement", "6")]);
    state = act(state, ids[3], { type: "draw" }, ctx);
    state = act(state, ids[3], { type: "swap", cardId: `p${seat}c0` }, ctx);
    expect(state.discard.at(-1)).toBe(`p${seat}c0`);
    expect(state.phase).toBe("final");
    expect(state.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
    state = act(state, ids[0], { type: "stick", cardId: "p0c0" }, ctx);
    expect(player(state, ids[0]).hand[0]).toBeNull();
  });

  it("starts the full window after a final power finishes", () => {
    const fixture = lastTurn([["7"], ["2"], ["3"], ["4"]]);
    const { ctx, ids } = fixture;
    let state = placeLast(fixture, "7");
    expect(state.turn?.stage).toBe("power");
    expect(state.stickWindowUntil).toBeNull();
    ctx.tick(STICK_WINDOW_MS + 100);
    state = act(state, ids[3], { type: "skipPower" }, ctx);
    expect(state.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
    state = act(state, ids[0], { type: "stick", cardId: "p0c0" }, ctx);
    expect(state.phase).toBe("final");
  });

  it("holds an automatically discarded final card open when the final player times out", () => {
    const { ctx, ids, state: initial } = lastTurn();
    let state = rigDeck(initial, [card("idle-final", "5")]);
    state = act(state, ids[3], { type: "draw" }, ctx);
    ctx.tick(TURN_TIMEOUT_MS);
    state = timeout(state, ctx);
    expect(state.discard.at(-1)).toBe("idle-final");
    expect(state.turn).toBeNull();
    expect(state.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
    state = act(state, ids[0], { type: "stick", cardId: "p0c0" }, ctx);
    expect(player(state, ids[0]).hand[0]).toBeNull();
  });

  it("does not score in the middle of an accepted zero-card stick after an old deadline", () => {
    const fixture = lastTurn();
    const { ctx, ids } = fixture;
    let state = placeLast(fixture);
    ctx.tick(STICK_WINDOW_MS + 1);
    // A stick and timer may race. If the stick is serialized first, every
    // consequence of that accepted action must finish before any scoring.
    state = act(state, ids[0], { type: "stick", cardId: "p0c0" }, ctx);
    expect(state.phase).toBe("final");
    expect(state.results).toEqual([]);
    expect(state.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
    state = act(state, ids[1], { type: "stick", cardId: "p1c0" }, ctx);
    expect(player(state, ids[1]).hand[0]).toBeNull();
    expect(state.tally[ids[0]].sticks).toBe(1);
    expect(state.tally[ids[1]].sticks).toBe(1);
    expect(timeout(state, ctx)).toBe(state);
  });

  it("keeps the full renewed window even after the last matching card is stuck", () => {
    const fixture = lastTurn([["5"], ["2"], ["3"], ["4"]]);
    const { ctx, ids } = fixture;
    let state = placeLast(fixture);
    ctx.tick(STICK_WINDOW_MS - 100);
    state = act(state, ids[0], { type: "stick", cardId: "p0c0" }, ctx);
    expect(state.phase).toBe("final");
    expect(state.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
    ctx.tick(STICK_WINDOW_MS);
    state = timeout(state, ctx);
    expect(state.phase).toBe("scoring");
    expect(state.results[0].scores.find((s) => s.playerId === ids[0])?.score).toBe(0);
  });

  it("does not let incorrect sticks prolong the final window", () => {
    const fixture = lastTurn();
    const { ctx, ids } = fixture;
    let state = placeLast(fixture);
    const deadline = state.stickWindowUntil;
    ctx.tick(STICK_WINDOW_MS - 1);
    state = act(state, ids[2], { type: "stick", cardId: "p2c0" }, ctx);
    expect(state.tally[ids[2]].misses).toBe(1);
    expect(state.stickWindowUntil).toBe(deadline);
    ctx.tick(1);
    expect(timeout(state, ctx).phase).toBe("scoring");
  });

  it.each(["give", "timeout"] as const)("suspends the window for debt and restarts it after %s", (resolution) => {
    const fixture = lastTurn();
    const { ctx, ids } = fixture;
    let state = placeLast(fixture);
    state = act(state, ids[2], { type: "stick", cardId: "p1c0" }, ctx);
    expect(state.pendingGives).toHaveLength(1);
    expect(state.stickWindowUntil).toBeNull();
    ctx.tick(STICK_WINDOW_MS + 1);
    expect(timeout(state, ctx)).toBe(state);
    if (resolution === "timeout") {
      ctx.tick(TURN_TIMEOUT_MS);
      state = timeout(state, ctx);
    } else {
      state = act(state, ids[2], { type: "give", cardId: "p2c0" }, ctx);
    }
    expect(state.pendingGives).toEqual([]);
    expect(state.phase).toBe("final");
    expect(state.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
    state = act(state, ids[0], { type: "stick", cardId: "p0c0" }, ctx);
    expect(player(state, ids[0]).hand[0]).toBeNull();
  });

  it("freezes the remaining reaction time while the table is paused", () => {
    const fixture = lastTurn();
    const { ctx, ids } = fixture;
    let state = placeLast(fixture);
    const deadline = state.stickWindowUntil!;
    ctx.tick(1_000);
    state = act(state, ids[0], { type: "pauseRequest" }, ctx);
    for (const id of ids.slice(1)) state = act(state, id, { type: "pauseVote", agree: true }, ctx);
    ctx.tick(10_000);
    expect(timeout(state, ctx)).toBe(state);
    expect(planBots(state, ctx.now, () => 0.5)).toEqual([]);
    state = act(state, ids[0], { type: "pauseRequest" }, ctx);
    for (const id of ids.slice(1)) state = act(state, id, { type: "pauseVote", agree: true }, ctx);
    expect(state.stickWindowUntil).toBe(deadline + 10_000);
    ctx.tick(STICK_WINDOW_MS - 1_001);
    expect(timeout(state, ctx)).toBe(state);
    ctx.tick(1);
    expect(timeout(state, ctx).phase).toBe("scoring");
  });

  it("schedules final scoring on the server even with four human seats", () => {
    const fixture = lastTurn();
    const { ctx } = fixture;
    const state = placeLast(fixture);
    const plans = planBots(state, ctx.now, () => 0.5);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ action: { type: "timeout" }, delayMs: STICK_WINDOW_MS });
    ctx.tick(plans[0].delayMs);
    const result = applyAction(state, { ...plans[0], actionId: "server-close" }, ctx);
    expect(result.state.phase).toBe("scoring");
  });

  it("allows a bot to claim a known match during the final window", () => {
    const fixture = lastTurn();
    const { ctx, ids } = fixture;
    let state = placeLast(fixture);
    player(state, ids[1]).isBot = true;
    player(state, ids[1]).difficulty = "hard";
    state.botKnown[ids[1]] = ["p1c0"];
    const plans = planBots(state, ctx.now, () => 0.5);
    const stick = plans.find((plan) => plan.action.type === "stick")!;
    expect(stick).toBeDefined();
    expect(stick.delayMs).toBeLessThan(STICK_WINDOW_MS);
    ctx.tick(stick.delayMs);
    state = act(state, stick.playerId, stick.action, ctx);
    expect(player(state, ids[1]).hand[0]).toBeNull();
    expect(state.phase).toBe("final");
    expect(state.stickWindowUntil).toBe(ctx.now + STICK_WINDOW_MS);
  });

  it("opens a final window for saved rounds missing the deadline field", () => {
    const fixture = lastTurn();
    delete (fixture.state as Partial<GameState>).stickWindowUntil;
    const state = placeLast(fixture);
    expect(state.phase).toBe("final");
    expect(state.stickWindowUntil).toBe(fixture.ctx.now + STICK_WINDOW_MS);
  });
});
