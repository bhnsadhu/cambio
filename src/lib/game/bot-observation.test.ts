import { describe, expect, it } from "vitest";
import { observeBot } from "./bot-observation";
import { act, makeCtx, started } from "./testkit";
import type { GameState, Rank } from "./types";

function drawRank(state: GameState, me: string, rank: Rank, ctx: ReturnType<typeof makeCtx>) {
  const next = structuredClone(state);
  const id = next.deck.find((id) => next.cards[id].rank === rank)!;
  expect(id).toBeDefined();
  next.deck = [...next.deck.filter((other) => other !== id), id];
  next.turn = { playerId: me, stage: "draw", drawnCardId: null, startedAt: ctx.now };
  return act(next, me, { type: "draw" }, ctx);
}

describe.each(["easy", "medium", "hard"] as const)("%s plays with only its own observations", (difficulty) => {
  it("must obey the same turn, draw, and power restrictions as a human", () => {
    const ctx = makeCtx(73);
    const initial = started(ctx, 1);
    let state = initial.state;
    const me = state.players[1].id;
    state.players[1].difficulty = difficulty;
    expect(() => act(state, me, { type: "draw" }, ctx)).toThrow(/not your turn/i);
    expect(() => act(state, me, { type: "callCambio" }, ctx)).toThrow(/not your turn/i);
    expect(() => act(state, me, { type: "peekOther", cardId: state.players[0].hand[0]! }, ctx)).toThrow(/no power/i);
    state = drawRank(state, me, "2", ctx);
    expect(() => act(state, me, { type: "draw" }, ctx)).toThrow(/place or swap/i);
    expect(() => act(state, me, { type: "callCambio" }, ctx)).toThrow(/place or swap/i);
    expect(() => act(state, me, { type: "peekOwn", cardId: state.players[1].hand[0]! }, ctx)).toThrow(/no power/i);
  });

  it("gets only its two opening faces, no deck order, credentials, or shared bot memory", () => {
    const ctx = makeCtx(79);
    const { state } = started(ctx, 1);
    const bot = state.players[1];
    bot.difficulty = difficulty;
    const seen = observeBot(state, bot.id);
    expect(Object.keys(seen.cards).sort()).toEqual(bot.hand.slice(2).sort());
    expect(Object.keys(seen.botKnown)).toEqual([bot.id]);
    for (const field of ["deck", "reveals", "results", "botDifficulty", "appliedActionIds"]) expect(seen).not.toHaveProperty(field);
    for (const p of seen.players) {
      expect(p).not.toHaveProperty("token");
      expect(p).not.toHaveProperty("profileId");
    }
    for (const id of bot.hand.slice(0, 2)) expect(seen.cards[id!]).toBeUndefined();
    for (const p of state.players.filter((p) => p.id !== bot.id)) {
      for (const id of p.hand) expect(seen.cards[id!]).toBeUndefined();
    }
    const before = structuredClone(state);
    seen.players[1].hand[0] = null;
    seen.cards[bot.hand[2]!]!.rank = "JOKER";
    seen.botKnown[bot.id].length = 0;
    expect(state).toEqual(before);
  });

  it("sees its own draw and earned peek without sharing either with other bots", () => {
    const ctx = makeCtx(83);
    let { state } = started(ctx, 1);
    const me = state.players[1].id;
    const other = state.players[2].id;
    state.players[1].difficulty = difficulty;
    state = drawRank(state, me, "9", ctx);
    const drawn = state.turn!.drawnCardId!;
    expect(observeBot(state, me).cards[drawn]).toEqual(state.cards[drawn]);
    expect(observeBot(state, other).cards[drawn]).toBeUndefined();
    expect(observeBot(state, other).turn?.drawnCardId).toBeNull();
    state = act(state, me, { type: "place" }, ctx);
    expect(observeBot(state, other).cards[drawn]).toEqual(state.cards[drawn]);
    const target = state.players[0].hand[0]!;
    expect(observeBot(state, me).cards[target]).toBeUndefined();
    state = act(state, me, { type: "peekOther", cardId: target }, ctx);
    expect(observeBot(state, me).cards[target]).toEqual(state.cards[target]);
    expect(observeBot(state, other).cards[target]).toBeUndefined();
  });

  it("keeps pushed cards, face-down gifts, and penalty cards unknown until seen", () => {
    const ctx = makeCtx(89);
    const initial = started(ctx, 1);
    const { hostId } = initial;
    let state = initial.state;
    const me = state.players[1].id;
    state.players[1].difficulty = difficulty;
    state = act(state, hostId, { type: "draw" }, ctx);
    const pushed = state.turn!.drawnCardId!;
    state = act(state, hostId, { type: "swap", cardId: state.players[1].hand[0]! }, ctx);
    expect(observeBot(state, me).cards[pushed]).toBeUndefined();
    const gift = state.players[0].hand[0]!;
    state.pendingGives = [{ from: hostId, to: me, since: ctx.now }];
    state = act(state, hostId, { type: "give", cardId: gift }, ctx);
    expect(observeBot(state, me).cards[gift]).toBeUndefined();
    const top = state.discard.at(-1)!;
    const wrong = state.players[1].hand.find((id) => id && state.cards[id].rank !== state.cards[top].rank)!;
    const before = [...state.players[1].hand];
    state = act(state, me, { type: "stick", cardId: wrong }, ctx);
    const penalty = state.players[1].hand.find((id) => id && !before.includes(id))!;
    expect(penalty).toBeTruthy();
    expect(observeBot(state, me).cards[penalty]).toBeUndefined();
    expect(observeBot(state, me).cards[pushed]).toBeUndefined();
    expect(observeBot(state, me).cards[gift]).toBeUndefined();
  });

  it("a blind swap moves remembered identities without revealing unseen faces", () => {
    const ctx = makeCtx(97);
    let { state } = started(ctx, 1);
    const me = state.players[1].id;
    state.players[1].difficulty = difficulty;
    state = drawRank(state, me, "J", ctx);
    state = act(state, me, { type: "place" }, ctx);
    const known = state.botKnown[me].find((id) => state.players[1].hand.includes(id))!;
    expect(known).toBeDefined();
    const unseen = state.players[0].hand[0]!;
    state = act(state, me, { type: "blindSwap", cardIdA: known, cardIdB: unseen }, ctx);
    expect(state.players[1].hand).toContain(unseen);
    expect(observeBot(state, me).cards[unseen]).toBeUndefined();
    expect(state.players[0].hand).toContain(known);
    expect(observeBot(state, me).cards[known]).toEqual(state.cards[known]);
  });
});
