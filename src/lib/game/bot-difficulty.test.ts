import { describe, expect, it } from "vitest";
import { unseenValues } from "./bot-beliefs";
import { cardValue } from "./cards";
import { planBots } from "./bots";
import { act, card, makeCtx, rig, rigDeck, started } from "./testkit";
import type { Action, GameState } from "./types";

function decisionFixtures() {
  const ctx = makeCtx(53);
  let { state } = started(ctx, 1);
  const me = state.players[1].id;
  for (const p of state.players) p.isBot = p.id === me;
  state.turn = { playerId: me, stage: "draw", drawnCardId: null, startedAt: ctx.now };
  state = rig(state, me, [card("own-ace", "A"), card("own-nine", "9"), card("own-five", "5"), card("own-six", "6")]);
  for (const p of state.players.filter((p) => p.id !== me)) {
    state = rig(state, p.id, [card(`${p.id}-ace`, "A"), card(`${p.id}-two`, "2")]);
  }
  state.botKnown[me] = state.players.flatMap((p) => p.hand.filter((id): id is string => !!id));
  const draw = (rank: "2" | "7" | "J" | "K") => act(rigDeck(state, [card(`drawn-${rank}`, rank)]), me, { type: "draw" }, ctx);
  const power = (rank: "7" | "J" | "K") => act(draw(rank), me, { type: "place" }, ctx);
  const peek = power("7");
  peek.botKnown[me] = peek.botKnown[me].filter((id) => id !== "own-six");
  const king = act(power("K"), me, { type: "kingLook", cardIdA: "own-nine", cardIdB: `${state.hostId}-ace` }, ctx);
  const give = structuredClone(state);
  give.pendingGives = [{ from: me, to: state.hostId, since: ctx.now }];
  const stick = structuredClone(state);
  stick.cards.top = card("top", "5");
  stick.discard = ["top"];
  const cases: { label: string; state: GameState; action: Action }[] = [
    { label: "replacement", state: draw("2"), action: { type: "swap", cardId: "own-nine" } },
    { label: "peek", state: peek, action: { type: "peekOwn", cardId: "own-six" } },
    { label: "blind swap", state: power("J"), action: { type: "blindSwap", cardIdA: `${state.hostId}-ace`, cardIdB: "own-nine" } },
    { label: "king decision", state: king, action: { type: "kingDecide", swap: true } },
    { label: "give", state: give, action: { type: "give", cardId: "own-nine" } },
    { label: "stick", state: stick, action: { type: "stick", cardId: "own-five" } },
  ];
  return { cases, me, ctx };
}

describe("50 / 75 / 100 percent strategic decisions", () => {
  it.each([
    ["easy", 50], ["medium", 75], ["hard", 100],
  ] as const)("%s uses the strongest choice on %i of 100 evenly sampled opportunities", (level, expected) => {
    const { cases, me, ctx } = decisionFixtures();
    for (const fixture of cases) {
      fixture.state.players.find((p) => p.id === me)!.difficulty = level;
      let strong = 0;
      for (let sample = 0; sample < 100; sample++) {
        const jitter = (key: string) => key.includes(":skill:") ? (sample + 0.5) / 100 : 0.99;
        const plans = planBots(fixture.state, ctx.now, jitter).filter((p) => p.playerId === me);
        if (plans.some((p) => JSON.stringify(p.action) === JSON.stringify(fixture.action))) strong++;
        // Re-reading the same opportunity, even later, does not reroll it.
        expect(planBots(fixture.state, ctx.now + 100, jitter).filter((p) => p.playerId === me), fixture.label).toEqual(plans);
        for (const plan of plans) expect(() => act(fixture.state, me, plan.action, ctx), fixture.label).not.toThrow();
      }
      expect(strong, fixture.label).toBe(expected);
    }
  });
});

describe("full observed-card counting", () => {
  it("shares the same exact count at all levels when they remember the same cards", () => {
    const ctx = makeCtx(61);
    const { state } = started(ctx, 1);
    const bot = state.players[1];
    state.discard = state.deck.splice(-12);
    // A remembered face on the discard must only be counted once.
    state.botKnown[bot.id].push(state.discard[0]);
    const observed = new Set([...state.discard, ...state.botKnown[bot.id]]);
    const expected = Object.values(state.cards).filter((c) => !observed.has(c.id)).map(cardValue).sort((a, b) => a - b);
    for (const level of ["easy", "medium", "hard"] as const) {
      bot.difficulty = level;
      expect(unseenValues(state, bot).sort((a, b) => a - b)).toEqual(expected);
    }
  });

  it("recounts the recycled deck without remembering shuffled card positions", () => {
    const ctx = makeCtx(67);
    let { state } = started(ctx, 1);
    const bot = state.players[1];
    bot.difficulty = "hard";
    state.discard = state.deck.splice(0);
    state.turn = { playerId: bot.id, stage: "draw", drawnCardId: null, startedAt: ctx.now };
    state = act(state, bot.id, { type: "draw" }, ctx);
    const observed = new Set([...state.discard, ...state.botKnown[bot.id]]);
    const expected = Object.values(state.cards).filter((c) => !observed.has(c.id)).map(cardValue).sort((a, b) => a - b);
    expect(unseenValues(state, state.players[1]).sort((a, b) => a - b)).toEqual(expected);
    expect(state.botKnown[bot.id].some((id) => state.deck.includes(id))).toBe(false);
  });
});

describe("discard tactics", () => {
  it("hard keeps its red king and sets up an own-card stick by swapping into an opponent's match", () => {
    const ctx = makeCtx(73);
    let { state } = started(ctx, 1);
    const me = state.players[1].id;
    state.players[1].difficulty = "hard";
    state = rig(state, me, [card("own-six", "6"), card("own-red-king", "K", "H")]);
    for (const p of state.players.filter((p) => p.id !== me)) state = rig(state, p.id, [card(`${p.id}-six`, "6")]);
    state.botKnown[me] = state.players.flatMap((p) => p.hand.filter((id): id is string => !!id));
    state.turn = { playerId: me, stage: "draw", drawnCardId: null, startedAt: ctx.now };
    state = act(rigDeck(state, [card("drawn-five", "5")]), me, { type: "draw" }, ctx);
    const plan = planBots(state, ctx.now, () => 0.99).find((p) => p.playerId === me)!;
    expect(plan.action).toEqual({ type: "swap", cardId: `${state.hostId}-six` });
    state = act(state, me, plan.action, ctx);
    const stick = planBots(state, ctx.now, () => 0.99).find((p) => p.playerId === me && p.action.type === "stick")!;
    expect(stick.action).toEqual({ type: "stick", cardId: "own-six" });
    state = act(state, me, stick.action, ctx);
    expect(state.players.find((p) => p.id === me)!.hand.filter(Boolean)).toEqual(["own-red-king"]);
  });
});
