import { describe, expect, it } from "vitest";
import { planBots } from "./bots";
import { applyAction, cardCount, createGame } from "./engine";
import { makeCtx } from "./testkit";
import type { GameState } from "./types";

/**
 * Whole-table simulation: four bots play complete rounds. This exercises the
 * engine and the bot strategy together and checks the invariants that make a
 * card game trustworthy: no card is ever created or lost, every round ends,
 * and every planned bot action is legal at the moment it is planned.
 */
function simulate(seed: number): { state: GameState; steps: number } {
  const ctx = makeCtx(seed);
  const { state: s0, hostId } = createGame(`SIM${seed}`, "Host", ctx);
  let state = structuredClone(s0);
  state.players[0].isBot = true; // the host plays as a bot too
  state = applyAction(state, { actionId: "start", playerId: hostId, action: { type: "start" } }, ctx).state;

  const jitter = (intent: string) => {
    let h = 2166136261;
    for (const ch of intent) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    return (h % 1000) / 1000;
  };

  let steps = 0;
  let n = 0;
  while (state.phase !== "scoring" && steps < 600) {
    const plans = planBots(state, ctx.now, jitter);
    expect(plans.length, `bots must always have a move in phase ${state.phase}`).toBeGreaterThan(0);
    plans.sort((a, b) => a.delayMs - b.delayMs);
    const plan = plans[0];
    ctx.tick(plan.delayMs + 1);
    const r = applyAction(state, { actionId: `s${seed}-${++n}`, playerId: plan.playerId, action: plan.action }, ctx);
    state = r.state;
    steps++;
    // Conservation: 54 cards exist and every card is in exactly one place.
    const inHands = state.players.flatMap((p) => p.hand.filter((c): c is string => !!c));
    const drawn = state.turn?.drawnCardId ? [state.turn.drawnCardId] : [];
    const all = [...state.deck, ...state.discard, ...inHands, ...drawn];
    expect(all.length).toBe(54);
    expect(new Set(all).size).toBe(54);
    expect(Object.keys(state.cards).sort()).toEqual(all.slice().sort());
  }
  return { state, steps };
}

describe("bots", () => {
  it("four bots always finish a round with legal moves and conserved cards", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { state, steps } = simulate(seed);
      expect(state.phase, `seed ${seed} did not finish in ${steps} steps`).toBe("scoring");
      expect(state.results).toHaveLength(1);
      const r = state.results[0];
      expect(r.winnerIds.length).toBeGreaterThan(0);
      const min = Math.min(...r.scores.map((s) => s.score));
      for (const w of r.winnerIds) expect(r.scores.find((s) => s.playerId === w)!.score).toBe(min);
      for (const p of state.players) {
        expect(r.scores.find((s) => s.playerId === p.id)!.cards.length).toBe(cardCount(p));
      }
    }
  });

  it("bots only ever stick cards they have actually seen", () => {
    const ctx = makeCtx(7);
    const { state: s0, hostId } = createGame("K", "Host", ctx);
    let state = structuredClone(s0);
    state.players[0].isBot = true;
    state = applyAction(state, { actionId: "start", playerId: hostId, action: { type: "start" } }, ctx).state;
    ctx.tick(11_000);
    let n = 0;
    for (let i = 0; i < 300 && state.phase !== "scoring"; i++) {
      const plans = planBots(state, ctx.now, () => 0.5).sort((a, b) => a.delayMs - b.delayMs);
      const plan = plans[0];
      if (plan.action.type === "stick") {
        expect(state.botKnown[plan.playerId]).toContain(plan.action.cardId);
      }
      ctx.tick(plan.delayMs + 1);
      state = applyAction(state, { actionId: `k${++n}`, playerId: plan.playerId, action: plan.action }, ctx).state;
    }
  });
});
