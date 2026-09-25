import { describe, expect, it } from "vitest";
import { applyAction, STICK_WINDOW_MS } from "./engine";
import { act, card, makeCtx, rig, rigDeck, settleFinalTurns, started } from "./testkit";
import { projectFor } from "./view";
import type { Card } from "./types";

function finalTurn() {
  const ctx = makeCtx();
  const { state: initial, ids } = started(ctx);
  let state = initial;
  // Explicit mixed-value totals: red kings -1; black kings/jokers 0; J/Q 10.
  const hands = [
    [card("red-king", "K", "H")],
    [card("ace", "A"), card("queen", "Q"), card("black-king", "K"), card("joker", "JOKER", null)],
    [card("jack", "J"), card("nine", "9"), card("diamond-king", "K", "D")],
    [card("five", "5"), card("eight", "8")],
  ];
  hands.forEach((hand, seat) => { state = rig(state, ids[seat], hand); });
  state = act(state, ids[0], { type: "callCambio" }, ctx);
  for (const id of ids.slice(1, 3)) {
    state = rigDeck(state, [card(`draw-${id}`, "2")]);
    state = act(state, id, { type: "draw" }, ctx);
    state = act(state, id, { type: "place" }, ctx);
  }
  state = rigDeck(state, [card("last-draw", "5")]);
  state = act(state, ids[3], { type: "draw" }, ctx);
  return { ctx, ids, state };
}

describe("final scores include every settled card exactly once", () => {
  const penalties: [Card, number][] = [
    [card("penalty", "10"), 10], [card("penalty", "K", "D"), -1],
    [card("penalty", "K", "C"), 0], [card("penalty", "JOKER", null), 0],
  ];
  it.each(penalties)("counts a %j wrong-stick penalty on the final turn (value %i)", (penalty, value) => {
    const { ctx, ids, state: initial } = finalTurn();
    let state = rigDeck(initial, [penalty]);
    const miss = { actionId: "wrong-stick", playerId: ids[3], action: { type: "stick" as const, cardId: "eight" } };
    state = applyAction(state, miss, ctx).state; // Pile is 2; final player still holds the draw.
    expect(applyAction(state, miss, ctx).changed).toBe(false); // HTTP retry cannot add a second penalty.
    state = act(state, ids[3], { type: "place" }, ctx);
    state = act(state, ids[3], { type: "stick", cardId: "five" }, ctx);
    state = settleFinalTurns(state, ctx);
    expect(state.results[0].scores.map((s) => s.score)).toEqual([-1, 11, 18, 8 + value]);
    expect(state.results[0].scores[3].cards.map((c) => c.id)).toEqual(["eight", "penalty"]);
    expect(state.results[0].tally?.[ids[3]]).toEqual({ sticks: 1, misses: 1 });
    for (const id of ids) expect(projectFor(state, 1, id, ctx.now).public.results).toEqual(state.results);
  });

  it("includes a penalty accepted at the final deadline before scoring and rejects later attempts", () => {
    const { ctx, ids, state: initial } = finalTurn();
    let state = act(initial, ids[3], { type: "place" }, ctx);
    state = rigDeck(state, [card("penalty", "6")]);
    ctx.tick(STICK_WINDOW_MS);
    state = act(state, ids[1], { type: "stick", cardId: "ace" }, ctx);
    expect(state.phase).toBe("scoring");
    expect(state.results[0].scores.map((s) => s.score)).toEqual([-1, 17, 18, 13]);
    expect(() => act(state, ids[1], { type: "stick", cardId: "ace" }, ctx)).toThrow();
    expect(state.results).toHaveLength(1);
  });

  it("scores after an owed card, a wrong stick, and a final power have all settled", () => {
    const { ctx, ids, state: initial } = finalTurn();
    initial.cards["last-draw"] = card("last-draw", "7");
    let state = rig(initial, ids[2], [card("seven", "7"), card("nine", "9"), card("red", "K", "D")]);
    state = act(state, ids[3], { type: "place" }, ctx);
    state = rigDeck(state, [card("penalty", "Q")]);
    state = act(state, ids[3], { type: "stick", cardId: "eight" }, ctx);
    state = act(state, ids[1], { type: "stick", cardId: "seven" }, ctx);
    state = act(state, ids[1], { type: "give", cardId: "queen" }, ctx);
    expect(state.results).toEqual([]);
    state = act(state, ids[3], { type: "peekOwn", cardId: "five" }, ctx);
    state = settleFinalTurns(state, ctx);
    expect(state.results[0].scores.map((s) => s.score)).toEqual([-1, 1, 18, 23]);
    expect(state.results[0].scores[2].cards.map((c) => c.id)).toEqual(["queen", "nine", "red"]);
  });
});
