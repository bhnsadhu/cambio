import { describe, expect, it } from "vitest";
import { canStick, TURN_TIMEOUT_MS } from "./engine";
import { act, card, makeCtx, player, rig, rigDeck, settleFinalTurns, started } from "./testkit";

function fixture() {
  const ctx = makeCtx();
  const { state: initial, ids } = started(ctx);
  let state = initial;
  for (let i = 0; i < 4; i++) state = rig(state, ids[i], [card(`hand-${i}`, "5")]);
  state.cards.top = card("top", "5");
  state.discard.push("top");
  return { ctx, ids, state };
}

describe("zero permanently ends participation in a round", () => {
  it("ends the active player's turn immediately and never penalizes that empty hand", () => {
    const { ctx, ids, state: initial } = fixture();
    let state = act(initial, ids[0], { type: "stick", cardId: "hand-0" }, ctx);
    expect(state.turn?.playerId).toBe(ids[1]);
    // The second player goes out during the same final sequence.
    state = act(state, ids[1], { type: "stick", cardId: "hand-1" }, ctx);
    expect(state.turn?.playerId).toBe(ids[2]);
    expect(state.cambio?.callerId).toBe(ids[0]);
    for (const id of ids.slice(0, 2)) {
      expect(() => act(state, id, { type: "draw" }, ctx)).toThrow();
      expect(canStick(state, id)).toBe(false);
    }
    for (const id of ids.slice(2)) {
      expect(state.turn?.playerId).toBe(id);
      state = rigDeck(state, [card(`draw-${id}`, "2")]);
      state = act(state, id, { type: "draw" }, ctx);
      state = act(state, id, { type: "place" }, ctx);
    }
    state = settleFinalTurns(state, ctx);
    ctx.tick(TURN_TIMEOUT_MS);
    state = act(state, ids[0], { type: "timeout" }, ctx);
    expect(state.results[0].scores.map((s) => s.score)).toEqual([0, 0, 5, 5]);
    expect(state.log.filter((e) => e.kind === "draw").map((e) => e.actorId)).toEqual(ids.slice(2));
    expect(state.log.filter((e) => e.kind === "cambio")).toHaveLength(1);
  });

  it("skips an off-turn zero even after another player pays a card back into that hand", () => {
    const { ctx, ids, state: initial } = fixture();
    let state = act(initial, ids[0], { type: "stick", cardId: "hand-0" }, ctx);
    state = act(state, ids[1], { type: "stick", cardId: "hand-2" }, ctx);
    state = act(state, ids[1], { type: "give", cardId: "hand-1" }, ctx);
    expect(player(state, ids[2]).hand).toContain("hand-1");
    expect(canStick(state, ids[2])).toBe(false);
    expect(() => act(state, ids[2], { type: "stick", cardId: "hand-1" }, ctx)).toThrow();
    expect(state.turn?.playerId).toBe(ids[3]);
    expect(state.cambio?.remaining).toEqual([]);
    expect(state.cambio?.callerId).toBe(ids[0]);
  });

  it.each(["decide", "power"] as const)("settles a zero during %s without a new draw, power or penalty", (stage) => {
    const { ctx, ids, state: initial } = fixture();
    let state = rigDeck(initial, [card("held", stage === "power" ? "J" : "3")]);
    state = rig(state, ids[0], [card("last", stage === "power" ? "J" : "5")]);
    state = act(state, ids[0], { type: "draw" }, ctx);
    if (stage === "power") state = act(state, ids[0], { type: "place" }, ctx);
    state = act(state, ids[0], { type: "stick", cardId: "last" }, ctx);
    expect(state.turn?.playerId).toBe(ids[1]);
    expect(state.pendingPower).toBeNull();
    expect(state.discard.filter((id) => id === "held")).toHaveLength(1);
    expect(player(state, ids[0]).hand.every((id) => id === null)).toBe(true);
    expect(() => act(state, ids[0], { type: "skipPower" }, ctx)).toThrow();
  });

  it("does not add a timeout penalty after the last final player sticks their last card", () => {
    const { ctx, ids, state: initial } = fixture();
    let state = act(initial, ids[0], { type: "callCambio" }, ctx);
    for (const id of ids.slice(1, 3)) {
      state = rigDeck(state, [card(`draw-${id}`, "5")]);
      state = act(state, id, { type: "draw" }, ctx);
      state = act(state, id, { type: "place" }, ctx);
    }
    state = rigDeck(state, [card("unearned-penalty", "10")]);
    state = act(state, ids[3], { type: "stick", cardId: "hand-3" }, ctx);
    ctx.tick(TURN_TIMEOUT_MS);
    state = act(state, ids[0], { type: "timeout" }, ctx);
    state = settleFinalTurns(state, ctx);
    expect(state.phase).toBe("scoring");
    expect(state.results[0].scores.find((s) => s.playerId === ids[3])).toMatchObject({ score: 0, cards: [] });
    expect(state.deck.at(-1)).toBe("unearned-penalty");
  });

  it("automatically settles an excluded debtor's old obligation when an incoming card arrives", () => {
    const { ctx, ids, state: initial } = fixture();
    let state = act(initial, ids[0], { type: "stick", cardId: "hand-1" }, ctx);
    // The active player owes seat 1, then seat 2 removes their last card.
    state = act(state, ids[2], { type: "stick", cardId: "hand-0" }, ctx);
    expect(state.cambio?.callerId).toBe(ids[1]);
    expect(state.turn?.playerId).toBe(ids[2]);
    state = act(state, ids[2], { type: "give", cardId: "hand-2" }, ctx);
    expect(state.pendingGives).toEqual([]);
    expect(player(state, ids[1]).hand).toContain("hand-2");
    expect(canStick(state, ids[1])).toBe(false);
    expect(state.turn?.playerId).toBe(ids[3]);
    expect(state.cambio?.zeroedIds).toEqual(expect.arrayContaining(ids.slice(0, 3)));
  });

  it.each([false, true])("keeps a zeroed seat excluded through bot replacement, with its debt paid first: %s", (paidFirst) => {
    const { ctx, ids, state: initial } = fixture();
    let state = act(initial, ids[0], { type: "stick", cardId: "hand-2" }, ctx);
    if (paidFirst) state = act(state, ids[0], { type: "give", cardId: "hand-0" }, ctx);
    state = act(state, ids[2], { type: "leaveTable" }, ctx);
    const replacement = state.players[2].id;
    expect(state.cambio?.zeroedIds).toContain(replacement);
    expect(state.cambio?.zeroedIds).toEqual([...new Set(state.cambio?.zeroedIds)]);
    if (!paidFirst) state = act(state, ids[0], { type: "give", cardId: "hand-0" }, ctx);
    expect(canStick(state, replacement)).toBe(false);
    for (const id of [ids[1], ids[3]]) {
      state = rigDeck(state, [card(`draw-${id}`, "2")]);
      state = act(state, id, { type: "draw" }, ctx);
      state = act(state, id, { type: "place" }, ctx);
    }
    state = settleFinalTurns(state, ctx);
    for (const id of [ids[0], ids[1], ids[3]]) state = act(state, id, { type: "playAgain" }, ctx);
    expect(state.cambio).toBeNull();
  });
});
